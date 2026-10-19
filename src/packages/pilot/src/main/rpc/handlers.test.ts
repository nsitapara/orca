import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import Database from '../../../../../main/sqlite/sync-database'
import { loadDefinitions } from '../definitions/loader'
import type { PilotContext } from '../pilot-context'
import { PilotStore } from '../store/store'
import { activity, getAutomation, listAutomations, validateYaml } from './handlers'

const YAML =
  'name: Fix CI\nrepo: web-platform\nschedule: "10 * * * *"\nitems: { kind: merge_request }\nchecks: [ { worktree: exists } ]\nsteps: [ { agent: claude, prompt: x } ]\n'

function schedulerStub(nextTickAt: number | null, ticksHere: boolean): PilotContext['scheduler'] {
  const stub = { nextTickAt: () => nextTickAt, ticksHere: () => ticksHere }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handlers read only the scheduler's nextTickAt and ticksHere.
  return stub as never
}

function context() {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-rpc-'))
  writeFileSync(join(dir, 'ci.yaml'), YAML)
  writeFileSync(join(dir, 'bad.yaml'), 'name: [')
  const store = PilotStore.open(join(dir, 'db.sqlite'))
  const loaded = loadDefinitions([dir])
  return {
    dir,
    store,
    ctx: {
      processKind: 'main' as const,
      store,
      dirs: [dir],
      loaded: () => loaded,
      reload: () => loaded,
      scheduler: schedulerStub(Date.UTC(2026, 9, 10, 20, 10), true),
      actions: { entries: () => [], get: () => null },
      dispatcher: null,
      schedulerOn: true
    }
  }
}

describe('Pilot API handlers', () => {
  it('labels a run-once automation by what it runs on', () => {
    const onceDir = mkdtempSync(join(tmpdir(), 'pilot-rpc-once-'))
    writeFileSync(
      join(onceDir, 'pull.yaml'),
      'name: Pull dev\nrepo: web-platform\nschedule: manual\nsteps: [ { agent: shell, run: ./pull.sh } ]\n'
    )
    const { ctx } = context()
    const loaded = loadDefinitions([onceDir])
    const payload = listAutomations({ ...ctx, loaded: () => loaded })
    expect(payload.automations.map((a) => [a.id, a.itemKind, a.agent])).toEqual([
      ['pull', 'Runs once', 'shell']
    ])
  })

  it('lists automations with their last tick and file errors', () => {
    const { ctx, store } = context()
    const tick = store.startTick('ci', 1)
    store.finishTick(tick, 'ok', null, { started: 1 }, 2)
    const payload = listAutomations(ctx)
    expect(payload.automations.map((a) => [a.id, a.agent, a.itemKind, a.lastTick?.counts])).toEqual(
      [['ci', 'claude', 'Merge requests', { started: 1 }]]
    )
    expect(payload.errors.map((e) => e.file.endsWith('bad.yaml'))).toEqual([true])
  })

  it('shows no next tick for an automation shown only from its last valid version', () => {
    const { ctx } = context()
    const loaded = ctx.loaded()
    const held = { ...ctx, loaded: () => ({ ...loaded, displayOnly: ['ci'] }) }
    expect(listAutomations(ctx).automations[0].nextTickAt).not.toBeNull()
    expect(listAutomations(held).automations[0].nextTickAt).toBeNull()
  })

  it('says where each automation runs and whether this machine ticks it', () => {
    const { ctx } = context()
    expect(listAutomations(ctx).automations.map((a) => [a.runsOn, a.ticksHere])).toEqual([
      [null, true]
    ])
    expect(listAutomations({ ...ctx, schedulerOn: false }).automations[0].ticksHere).toBe(false)
    const elsewhere = { ...ctx, scheduler: schedulerStub(null, false) }
    expect(listAutomations(elsewhere).automations[0].ticksHere).toBe(false)
  })

  it('returns a definition with its YAML text and check names', () => {
    const { ctx } = context()
    expect(getAutomation(ctx, 'ci')).toMatchObject({ yaml: YAML, checkNames: ['Worktree'] })
    expect(() => getAutomation(ctx, 'nope')).toThrow('No automation "nope"')
  })

  it('returns ticks with their items and runs, newest first', () => {
    const { ctx, store } = context()
    const t1 = store.startTick('ci', 1)
    store.finishTick(t1, 'ok', null, {}, 1)
    const t2 = store.startTick('ci', 2)
    store.finishTick(t2, 'ok', null, {}, 2)
    store.runs.create({
      id: 'r1',
      automationId: 'ci',
      tickId: t1,
      itemKey: '!1',
      itemLabel: '!1',
      worktreePath: null,
      startedAt: 1
    })
    store.runs.createStep({
      runId: 'r1',
      idx: 0,
      name: 's',
      agent: 'claude',
      skill: null,
      startedAt: 1
    })
    const ticks = activity(ctx, 'ci', 10)
    expect(ticks.map((t) => t.id)).toEqual([t2, t1])
    expect(ticks[1].runs.map((r) => [r.id, r.steps.map((s) => s.name)])).toEqual([['r1', ['s']]])
    expect(activity(ctx, 'ci', 1)).toHaveLength(1)
  })

  it('skipQuiet leaves out each tick that finished with nothing to do, and the limit counts only those it keeps', () => {
    const { ctx, store } = context()
    const tick = (
      at: number,
      status: 'ok' | 'failed',
      counts: Record<string, number>,
      warnings: string[] = []
    ) => {
      const id = store.startTick('ci', at)
      store.finishTick(id, status, status === 'failed' ? 'boom' : null, counts, at, warnings)
      return id
    }
    const failed = tick(1, 'failed', {})
    const started = tick(2, 'ok', { started: 1, notdue: 2 })
    const skipped = tick(3, 'ok', { skipped: 1 })
    const deferred = tick(4, 'ok', { over_limit: 1 })
    const warned = tick(5, 'ok', {}, ["Couldn't read WEB-1"])
    const ran = tick(6, 'ok', {})
    store.runs.create({
      id: 'r1',
      automationId: 'ci',
      tickId: ran,
      itemKey: '!1',
      itemLabel: '!1',
      worktreePath: null,
      startedAt: 6
    })
    const fed = tick(7, 'ok', { notdue: 1 })
    store.handovers.setTickTrigger(fed, {
      automationId: 'dev-e2e-fix',
      runId: 'run-1',
      stage: 1,
      ids: ['WEB-1']
    })
    const running = store.startTick('ci', 8)
    const empty = tick(9, 'ok', {})
    const notDue = tick(10, 'ok', { notdue: 3 })
    const outOfScope = tick(11, 'ok', { out_of_scope: 2, notdue: 1 })

    const kept = [running, fed, ran, warned, deferred, skipped, started, failed]
    expect(activity(ctx, 'ci', 20).map((t) => t.id)).toEqual([outOfScope, notDue, empty, ...kept])
    expect(activity(ctx, 'ci', 20, { skipQuiet: true }).map((t) => t.id)).toEqual(kept)
    expect(activity(ctx, 'ci', 2, { skipQuiet: true }).map((t) => t.id)).toEqual([running, fed])
  })

  it('says what triggered each tick and which handed-over ids it read; a tick with neither says so', () => {
    const { ctx, store } = context()
    const plain = store.startTick('ci', 1)
    const fed = store.startTick('ci', 2)
    const trigger = { automationId: 'dev-e2e-fix', runId: 'run-1', stage: 1, ids: ['WEB-2123'] }
    store.handovers.setTickTrigger(fed, trigger)
    store.handovers.add({
      senderId: 'dev-e2e-fix',
      senderRunId: 'run-1',
      receiverId: 'ci',
      itemIds: ['WEB-2123'],
      at: 1
    })
    const [row] = store.handovers.pending('ci', 10)
    store.handovers.consume(fed, 3, [
      { rowId: row.id, verdict: 'started', reason: 'Started', runId: 'r9' }
    ])
    const ticks = activity(ctx, 'ci', 10)
    expect(ticks.map((t) => [t.id, t.trigger, t.handedOver?.map((h) => h.itemId)])).toEqual([
      [fed, trigger, ['WEB-2123']],
      [plain, null, []]
    ])
    // The sender is no loaded stage here, so it has no stage number.
    expect(ticks[0].handedOver?.[0].senderStage).toBeNull()
  })

  it('shows a handover the scheduler pass expired under the tick it came after', () => {
    const { ctx, store } = context()
    const older = store.startTick('ci', 100)
    const newer = store.startTick('ci', 300)
    const note = (at: number, text: string) =>
      store.events.add({
        at,
        kind: 'handover_expired',
        automationId: 'ci',
        itemKey: 'WEB-1',
        payload: { text }
      })
    note(200, 'Handover of WEB-1 from stage 1 expired after 7 days')
    note(400, 'Handover of WEB-2 from stage 1 expired after 7 days')
    store.events.add({
      at: 250,
      kind: 'handover_expired',
      automationId: 'other',
      payload: { text: 'not ours' }
    })
    const ticks = activity(ctx, 'ci', 10)
    expect(ticks.map((t) => [t.id, t.notes])).toEqual([
      [newer, [{ at: 400, text: 'Handover of WEB-2 from stage 1 expired after 7 days' }]],
      [older, [{ at: 200, text: 'Handover of WEB-1 from stage 1 expired after 7 days' }]]
    ])
  })

  it('gives a stage’s expiry notes from before its first tick with its definition, as standalone entries', () => {
    const { ctx, store } = context()
    const note = (at: number) =>
      store.events.add({
        at,
        kind: 'handover_expired',
        automationId: 'ci',
        itemKey: 'WEB-1',
        payload: { text: `note ${at}` }
      })
    note(50)
    expect(activity(ctx, 'ci', 10)).toEqual([])
    expect(getAutomation(ctx, 'ci').notes).toEqual([{ at: 50, text: 'note 50' }])
    store.startTick('ci', 100)
    note(150)
    expect(getAutomation(ctx, 'ci').notes).toEqual([{ at: 50, text: 'note 50' }])
    expect(activity(ctx, 'ci', 10)[0].notes).toEqual([{ at: 150, text: 'note 150' }])
  })

  it('returns no activity for an unknown id', () => {
    expect(activity(context().ctx, 'nope', 10)).toEqual([])
  })

  it('validates YAML without saving it', () => {
    expect(validateYaml('name: x', 'draft.yaml').ok).toBe(false)
    const ok = validateYaml(YAML, 'my-draft.yaml')
    expect(ok.ok && ok.definition.id).toBe('my-draft')
  })
  it('lists what each run asked under it in Activity', () => {
    const { ctx, store, dir } = context()
    const t1 = store.startTick('ci', 1)
    store.finishTick(t1, 'ok', null, {}, 1)
    store.runs.create({
      id: 'r1',
      automationId: 'ci',
      tickId: t1,
      itemKey: 'mr:1',
      itemLabel: '!1',
      worktreePath: '/wt',
      startedAt: 1
    })
    new Database(join(dir, 'db.sqlite'))
      .prepare(
        `INSERT INTO inbox_items (id, automation_id, run_id, person, type, title, digest, created_at, updated_at)
         VALUES ('i1', 'ci', 'r1', 'nish', 'question', 'Push the fix?', 'd', 1, 1)`
      )
      .run()
    expect(activity(ctx, 'ci', 10)[0].runs[0].inbox.map((i) => i.title)).toEqual(['Push the fix?'])
  })

  it("returns a stage's most recent handover to each stage it passes ids to", () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-rpc-job-'))
    writeFileSync(
      join(dir, 'open.yaml'),
      'name: Open\nrepo: r\nschedule: manual\njob: { id: "13", name: J, stage: 1, label: Open, feeds: [{ to: start, pass: { id: ticket }, run: now }] }\nsteps: [ { name: ticket, agent: shell, run: ./t.sh, outputs: [ticket] } ]\n'
    )
    writeFileSync(
      join(dir, 'start.yaml'),
      'name: Start\nrepo: r\nschedule: manual\njob: { id: "13", stage: 2, label: Start }\nitems: { kind: linear_ticket, where: { ids_from: { feed: true } } }\nsteps: [ { agent: claude, prompt: x } ]\n'
    )
    const { ctx, store } = context()
    const loaded = loadDefinitions([dir])
    expect(loaded.errors).toEqual([])
    const job = { ...ctx, loaded: () => loaded }
    expect(getAutomation(job, 'open').handovers).toEqual([{ to: 'start', rows: [] }])
    store.handovers.add({
      senderId: 'open',
      senderRunId: 'run-1',
      receiverId: 'start',
      itemIds: ['WEB-1'],
      at: 5
    })
    expect(getAutomation(job, 'open').handovers).toEqual([
      { to: 'start', rows: [expect.objectContaining({ itemId: 'WEB-1', state: 'pending' })] }
    ])
    expect(getAutomation(job, 'start').handovers).toEqual([])
  })

  it('gives each automation its chain and its live runs with their steps', () => {
    const { ctx, store } = context()
    const run = (id: string, status: 'running' | 'done') =>
      store.runs.create({
        id,
        automationId: 'ci',
        tickId: null,
        itemKey: id,
        itemLabel: id,
        worktreePath: null,
        startedAt: 1,
        status
      })
    run('live', 'running')
    run('finished', 'done')
    store.runs.createStep({
      runId: 'live',
      idx: 0,
      name: 'step1',
      agent: 'claude',
      skill: null,
      startedAt: 1
    })
    const [ci] = listAutomations(ctx).automations
    expect(ci.chain.map((p) => p.key)).toEqual(['starts', 'picks', 'gates', 'workspace', 'step:0'])
    expect(ci.live.map((r) => [r.id, r.steps.length])).toEqual([['live', 1]])
    expect(getAutomation(ctx, 'ci').summary.live.map((r) => r.id)).toEqual(['live'])
  })
})
