import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { parsePeopleYaml } from '../../shared/people'
import { cardOf, inboxDigest } from '../inbox/card'
import { addInboxItem } from '../inbox/inbox-add'
import type { InboxDeps } from '../inbox/inbox-service'
import type { InboxAddParams } from '../../shared/inbox-types'
import { PilotStore } from '../store/store'
import type { InboxItemRow } from '../../shared/api-types'
import { attemptAction, refreshAction, type CardAttempt, type RunAttempt } from './attempt'
import { approvedArgs, proposalProblem } from './powers'
import type { ActionCatalog, ActionEntry } from './types'

const def = parseAutomationYaml(
  'name: Fix CI\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\npowers: [commit]\ninbox: nish\n',
  '/a/ci.yaml'
)
const people = parsePeopleYaml('people:\n  - { id: nish, name: Nish, gitlab: nish8 }\n')
if (!def.ok || !people.ok) {
  throw new Error('setup')
}

function setup(powers?: string[], loaded = true) {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-attempt-')), 'db.sqlite'))
  store.runs.create({
    id: 'run-1',
    automationId: 'ci',
    tickId: null,
    itemKey: 'mr:1561',
    itemLabel: '!1561',
    worktreePath: '/wt',
    startedAt: 1
  })
  const push: ActionEntry = {
    name: 'publish',
    power: 'push',
    label: 'Push',
    usage: 'push …',
    checkArgs: (args) => (Array.isArray(args.argv) ? null : 'usage: push …'),
    describe: async (args) => `Push ${(args.argv as string[])[1]} to origin`,
    run: vi.fn().mockResolvedValue({
      outcome: 'done',
      detail: 'pushed web-1 to 9c1e2f04',
      link: 'https://x',
      log: '/l',
      onYou: false
    }),
    refresh: vi.fn().mockResolvedValue({
      args: { argv: ['/wt', 'web-1', 'ffff', 'bbb'] },
      changed: 'head moved to ffff'
    })
  }
  const catalog: ActionCatalog = {
    entries: () => [push],
    get: (n) => (n === 'publish' ? push : null)
  }
  const definition = def.ok
    ? { ...def.definition, powers: (powers ?? def.definition.powers) as never }
    : (null as never)
  const definitions = () => (loaded ? [definition] : [])
  let n = 0
  const inbox: InboxDeps = {
    store,
    now: () => 50,
    definitions,
    people: () => (people.ok ? people.directory : (null as never)),
    newId: () => `in_${String(++n).padStart(16, '0')}`
  }
  return { store, push, inbox, deps: { store, now: () => 50, catalog, definitions, inbox } }
}

const REQ: RunAttempt = {
  action: 'publish',
  args: { argv: ['/wt', 'web-1', 'aaa', 'bbb'] },
  dryRun: false,
  runId: 'run-1',
  inboxItemId: null,
  approved: false
}

// A card's Approve, as Task 24c sends it: the card, the digest the answer approved, and parts left out.
function approve(card: InboxItemRow, extra: Partial<CardAttempt> = {}): CardAttempt {
  return {
    action: card.action ?? '',
    dryRun: false,
    runId: card.runId,
    approved: true,
    inboxItemId: card.id,
    digest: card.digest,
    ...extra
  }
}

describe('attemptAction', () => {
  it('runs an action the run has the power for, and records it', async () => {
    const { store, push, deps } = setup(['commit', 'push'])
    expect(await attemptAction(deps, REQ)).toMatchObject({
      outcome: 'done',
      detail: 'pushed web-1 to 9c1e2f04'
    })
    expect(push.run).toHaveBeenCalledWith(REQ.args, {
      dryRun: false,
      runId: 'run-1',
      inboxItemId: null
    })
    expect(store.actions.forRun('run-1')).toMatchObject([
      { action: 'publish', phase: 'do', status: 'done', dryRun: false, finishedAt: 50 }
    ])
    expect(store.events.list({ runId: 'run-1', kinds: ['action_run'] })).toHaveLength(1)
  })

  it("records an env run's action against its home, not the throwaway it works in", async () => {
    const { store, deps } = setup(['commit', 'push'])
    store.runs.envs.begin('run-1', '/wt', {})
    store.runs.envs.ready('run-1', {
      mode: 'throwaway',
      reason: '',
      path: '/agents/agents-run-1',
      home: '/wt',
      worktreeId: 'id',
      sha: null,
      envFile: null,
      vars: {},
      stack: null
    })
    await attemptAction(deps, REQ)
    const events = store.events.list({ runId: 'run-1', kinds: ['action_run'] })
    expect(events.map((e) => e.worktreePath)).toEqual(['/wt'])
  })

  it("asks the run's person instead when the power is missing, runs nothing, and records the ask", async () => {
    const { store, push, deps } = setup()
    const result = await attemptAction(deps, REQ)
    expect(result).toEqual({
      outcome: 'asked',
      detail: 'Asked nish first: "Fix CI" doesn\'t have the push power',
      inboxItemId: 'in_0000000000000001'
    })
    expect(push.run).not.toHaveBeenCalled()
    expect(store.inbox.get('in_0000000000000001')).toMatchObject({
      type: 'action',
      title: 'Push web-1 to origin?',
      action: 'publish',
      actionArgs: REQ.args,
      person: 'nish',
      runId: 'run-1'
    })
    expect(store.actions.forInboxItem('in_0000000000000001')).toMatchObject([
      { action: 'publish', status: 'refused', runId: 'run-1' }
    ])
    expect(store.events.list({ runId: 'run-1', kinds: ['action_run'] })).toEqual([])
  })

  it('writes no card on a dry run without the power', async () => {
    const { store, push, deps } = setup()
    expect(await attemptAction(deps, { ...REQ, dryRun: true })).toEqual({
      outcome: 'asked',
      detail: 'Would ask nish first: "Fix CI" doesn\'t have the push power',
      inboxItemId: null
    })
    expect(push.run).not.toHaveBeenCalled()
    expect(store.inbox.list({})).toEqual([])
  })

  it('finishes its row as failed when an entry throws, instead of leaving it running', async () => {
    const { store, push, deps } = setup(['push'])
    vi.mocked(push.run).mockRejectedValueOnce(new Error('act.py vanished'))
    expect(await attemptAction(deps, REQ)).toMatchObject({
      outcome: 'failed',
      detail: 'publish crashed: act.py vanished'
    })
    expect(store.actions.forRun('run-1')).toMatchObject([{ status: 'failed', finishedAt: 50 }])
  })

  it('records a not-yet attempt but no event', async () => {
    const { store, push, deps } = setup(['push'])
    vi.mocked(push.run).mockResolvedValueOnce({
      outcome: 'not_yet',
      detail: 'pipeline running',
      link: null,
      log: null,
      onYou: false
    })
    await attemptAction(deps, REQ)
    expect(store.actions.forRun('run-1')).toMatchObject([{ status: 'not_yet' }])
    expect(store.events.list({ runId: 'run-1', kinds: ['action_run'] })).toEqual([])
  })

  it('pins the arguments of the card it writes when the entry pins them', async () => {
    const { store, push, deps } = setup()
    push.pin = (args) => ({ ...args, write_id: 'w1' })
    await attemptAction(deps, REQ)
    expect(store.inbox.get('in_0000000000000001')?.actionArgs).toEqual({
      ...REQ.args,
      write_id: 'w1'
    })
  })

  it('pins from the attempt key: a retried attempt of a step gets the same pin, another step its own', async () => {
    const { push, deps } = setup(['push'])
    push.pin = (args, key) => ({ ...args, write_id: key })
    await attemptAction(deps, { ...REQ, stepIdx: 0 })
    await attemptAction(deps, {
      ...REQ,
      stepIdx: 0,
      args: { argv: [...(REQ.args.argv as string[])] }
    })
    await attemptAction(deps, { ...REQ, stepIdx: 1 })
    const ids = vi.mocked(push.run).mock.calls.map(([args]) => args.write_id)
    expect(ids[0]).toBe(ids[1])
    expect(ids[2]).not.toBe(ids[0])
  })

  it.each([
    ['an unknown action', { action: 'deploy' }, 'No action named "deploy" in Pilot\'s catalog'],
    ["args that don't fit", { args: { argv: 'x' } }, 'usage: push …'],
    [
      'no run behind an unapproved attempt',
      { runId: null },
      'Outside a Pilot run, approve actions in Pilot (Inbox), or run act.py directly.'
    ],
    ['a run Pilot has no record of', { runId: 'run-9' }, 'No run run-9']
  ])('refuses %s and runs nothing', async (_name, change, detail) => {
    const { push, deps } = setup(['push'])
    expect(await attemptAction(deps, { ...REQ, ...change })).toMatchObject({
      outcome: 'failed',
      detail
    })
    expect(push.run).not.toHaveBeenCalled()
  })

  it("refuses a run whose automation isn't loaded", async () => {
    const { push, deps } = setup(['push'], false)
    expect(await attemptAction(deps, REQ)).toMatchObject({
      outcome: 'failed',
      detail: 'Run run-1\'s automation "ci" isn\'t loaded; nothing runs'
    })
    expect(push.run).not.toHaveBeenCalled()
  })

  it('dry-runs an unapproved call with no run, and nothing more', async () => {
    const { push, deps } = setup()
    expect(await attemptAction(deps, { ...REQ, runId: null, dryRun: true })).toMatchObject({
      outcome: 'done'
    })
    expect(push.run).toHaveBeenCalledWith(REQ.args, {
      dryRun: true,
      runId: null,
      inboxItemId: null
    })
  })

  it('refuses an approval that names no card, or no digest', async () => {
    const { push, deps } = setup()
    const noCard = { ...REQ, approved: true } as unknown as CardAttempt
    expect(await attemptAction(deps, noCard)).toMatchObject({
      outcome: 'failed',
      detail: "An approval needs its card and the card's digest"
    })
    expect(push.run).not.toHaveBeenCalled()
  })
})

describe('attemptAction on an approved card', () => {
  async function asked(powers?: string[]) {
    const s = setup(powers)
    await attemptAction(s.deps, REQ)
    return { ...s, card: s.store.inbox.get('in_0000000000000001')! }
  }

  function file(inbox: InboxDeps, extra: Partial<InboxAddParams> = {}): InboxItemRow {
    const id = addInboxItem(inbox, {
      runId: 'run-1',
      type: 'action',
      title: 'Push?',
      action: 'publish',
      actionArgs: REQ.args,
      ...extra
    }).id!
    return inbox.store.inbox.get(id)!
  }

  // As 24c's revise would: new args on the card, a new digest.
  function revise(
    store: PilotStore,
    card: InboxItemRow,
    actionArgs: Record<string, unknown>
  ): InboxItemRow {
    const next = { ...cardOf(card), actionArgs }
    store.inbox.edit(card.id, { ...next, digest: inboxDigest(next) }, 60)
    return store.inbox.get(card.id)!
  }

  it('runs a card Pilot asked about, without the power: the approval is the go-ahead', async () => {
    const { push, deps, card } = await asked()
    expect(await attemptAction(deps, approve(card))).toMatchObject({ outcome: 'done' })
    expect(push.run).toHaveBeenCalledWith(REQ.args, {
      dryRun: false,
      runId: 'run-1',
      inboxItemId: card.id
    })
  })

  it("runs the card's own args, whatever args the request carries", async () => {
    const { push, deps, card } = await asked()
    const sneaky = { ...approve(card), args: { argv: ['/elsewhere', 'main', 'x', 'y'] } }
    expect(await attemptAction(deps, sneaky)).toMatchObject({ outcome: 'done' })
    expect(push.run).toHaveBeenCalledWith(REQ.args, {
      dryRun: false,
      runId: 'run-1',
      inboxItemId: card.id
    })
  })

  it("runs a card the automation filed itself while it has the action's power", async () => {
    const { push, deps, inbox } = setup(['push'])
    expect(await attemptAction(deps, approve(file(inbox)))).toMatchObject({ outcome: 'done' })
    expect(push.run).toHaveBeenCalled()
  })

  it('runs a card once: a second approval is refused', async () => {
    const { push, deps, card } = await asked()
    expect(await attemptAction(deps, approve(card))).toMatchObject({ outcome: 'done' })
    expect(await attemptAction(deps, approve(card))).toMatchObject({
      outcome: 'failed',
      detail: "Card in_0000000000000001's action already ran"
    })
    expect(push.run).toHaveBeenCalledTimes(1)
  })

  // Display = execution: the Run line (run-line.ts) shows approvedArgs, and the approval runs exactly them.
  it("runs exactly approvedArgs: the card's args less the parts left out, pinned with the card's key", async () => {
    const { push, deps, inbox } = setup(['push'])
    push.exceptArgs = (args, leftOut) => ({
      argv: [...(args.argv as string[]), '--except', leftOut.join(',')]
    })
    push.pin = (args, key) => ({ ...args, write_id: key })
    const card = file(inbox, { parts: { F1: 'Null check', F2: 'Naming' } })
    const shown = approvedArgs(push, card, ['F2'])
    expect(await attemptAction(deps, approve(card, { leftOut: ['F2'] }))).toMatchObject({
      outcome: 'done'
    })
    expect(push.run).toHaveBeenCalledWith('args' in shown ? shown.args : null, {
      dryRun: false,
      runId: 'run-1',
      inboxItemId: card.id
    })
  })

  it("passes the parts left out the entry's way, and only parts the card has", async () => {
    const { push, deps, inbox } = setup(['push'])
    push.exceptArgs = (args, leftOut) => ({
      argv: [...(args.argv as string[]), '--except', leftOut.join(',')]
    })
    const card = file(inbox, { parts: { F1: 'Null check', F2: 'Naming' } })
    expect(await attemptAction(deps, approve(card, { leftOut: ['F9'] }))).toMatchObject({
      outcome: 'failed',
      detail: 'Card in_0000000000000001 has no part F9'
    })
    expect(await attemptAction(deps, approve(card, { leftOut: ['F2'] }))).toMatchObject({
      outcome: 'done'
    })
    expect(push.run).toHaveBeenCalledWith(
      { argv: [...(REQ.args.argv as string[]), '--except', 'F2'] },
      { dryRun: false, runId: 'run-1', inboxItemId: card.id }
    )
  })

  it("refuses parts left out by an entry that can't leave any out", async () => {
    const { push, deps, inbox } = setup(['push'])
    const card = file(inbox, { parts: { F1: 'Null check' } })
    expect(await attemptAction(deps, approve(card, { leftOut: ['F1'] }))).toMatchObject({
      outcome: 'failed',
      detail: "publish can't leave parts out"
    })
    expect(push.run).not.toHaveBeenCalled()
  })

  it.each([
    [
      'no such card',
      (id: string) => ({ inboxItemId: `${id}x` }),
      'No inbox item in_0000000000000001x'
    ],
    [
      'another run',
      () => ({ runId: 'run-2' }),
      'Card in_0000000000000001 belongs to run run-1, not run-2'
    ],
    [
      'a changed card',
      () => ({ digest: 'old' }),
      'Card in_0000000000000001 changed since it was approved'
    ],
    ['no digest', () => ({ digest: '' }), "An approval needs its card and the card's digest"]
  ])('refuses %s', async (_name, change, detail) => {
    const { push, deps, card } = await asked()
    expect(await attemptAction(deps, approve(card, change(card.id)))).toMatchObject({
      outcome: 'failed',
      detail
    })
    expect(push.run).not.toHaveBeenCalled()
  })

  it('refuses a closed card', async () => {
    const { push, deps, store, card } = await asked()
    store.inbox.update(card.id, { status: 'done', outcome: 'skipped' }, 60)
    expect(await attemptAction(deps, approve(card))).toMatchObject({
      outcome: 'failed',
      detail: 'Card in_0000000000000001 is already done'
    })
    expect(push.run).not.toHaveBeenCalled()
  })

  it('refuses a card whose action differs from the one asked for', async () => {
    const { push, deps, card } = await asked()
    const other: ActionEntry = { ...push, name: 'mark_ready', power: 'mark_ready', run: vi.fn() }
    const catalog: ActionCatalog = {
      entries: () => [push, other],
      get: (n) => [push, other].find((e) => e.name === n) ?? null
    }
    expect(
      await attemptAction({ ...deps, catalog }, approve(card, { action: 'mark_ready' }))
    ).toMatchObject({
      outcome: 'failed',
      detail: 'Card in_0000000000000001 is for publish, not mark_ready'
    })
    expect(other.run).not.toHaveBeenCalled()
  })

  it("refuses a card its automation filed itself once the automation no longer has the action's power", async () => {
    const withPower = setup(['push'])
    const card = file(withPower.inbox)
    const without = { ...withPower.deps, definitions: setup().deps.definitions }
    const detail =
      "\"Fix CI\" doesn't have the push power and Pilot didn't ask for card in_0000000000000001; it can't run"
    expect(await attemptAction(without, approve(card))).toMatchObject({ outcome: 'failed', detail })
    expect(withPower.store.actions.forInboxItem(card.id)).toMatchObject([{ status: 'refused' }])
    // Its own refusal is no ask: approving it again is refused again.
    expect(await attemptAction(without, approve(card))).toMatchObject({ outcome: 'failed', detail })
    expect(withPower.push.run).not.toHaveBeenCalled()
  })

  it('refuses a card Pilot asked about once its args changed other than by its own refresh', async () => {
    const { push, deps, store, card } = await asked()
    const changed = revise(store, card, { argv: ['/elsewhere', 'main', 'x', 'y'] })
    expect(await attemptAction(deps, approve(changed))).toMatchObject({
      outcome: 'failed',
      detail: expect.stringContaining("Pilot didn't ask for card")
    })
    expect(push.run).not.toHaveBeenCalled()
  })

  it('runs a card Pilot asked about with the args its own refresh pinned again', async () => {
    const { push, deps, store, card } = await asked()
    const again = await refreshAction(deps, {
      action: 'publish',
      args: REQ.args,
      runId: 'run-1',
      inboxItemId: card.id
    })
    const revised = revise(store, card, again!.args)
    expect(await attemptAction(deps, approve(revised))).toMatchObject({ outcome: 'done' })
    expect(push.run).toHaveBeenCalledWith(
      { argv: ['/wt', 'web-1', 'ffff', 'bbb'] },
      { dryRun: false, runId: 'run-1', inboxItemId: card.id }
    )
  })

  // Group 22 note: a refresh row counts as Pilot's own only when what it refreshed was Pilot's already.
  it('refuses a card whose args came from a refresh of args Pilot never asked with', async () => {
    const { push, deps, store, card } = await asked()
    const foreign = await refreshAction(deps, {
      action: 'publish',
      args: { argv: ['/elsewhere', 'main', 'x', 'y'] },
      runId: 'run-1',
      inboxItemId: card.id
    })
    const revised = revise(store, card, foreign!.args)
    expect(await attemptAction(deps, approve(revised))).toMatchObject({
      outcome: 'failed',
      detail: expect.stringContaining("Pilot didn't ask for card")
    })
    expect(push.run).not.toHaveBeenCalled()
  })

  it('follows a chain of its own refreshes: asked, refreshed, refreshed again', async () => {
    const { push, deps, store, card } = await asked()
    const refresh = (args: Record<string, unknown>) =>
      refreshAction(deps, { action: 'publish', args, runId: 'run-1', inboxItemId: card.id })
    const first = await refresh(REQ.args)
    const once = revise(store, card, first!.args)
    vi.mocked(push.refresh!).mockResolvedValueOnce({
      args: { argv: ['/wt', 'web-1', 'eeee', 'bbb'] },
      changed: 'head moved to eeee'
    })
    const second = await refresh(once.actionArgs!)
    const twice = revise(store, once, second!.args)
    expect(await attemptAction(deps, approve(twice))).toMatchObject({ outcome: 'done' })
    expect(push.run).toHaveBeenCalledWith(
      { argv: ['/wt', 'web-1', 'eeee', 'bbb'] },
      { dryRun: false, runId: 'run-1', inboxItemId: card.id }
    )
  })

  it('refuses stored args that no longer fit the entry', async () => {
    const { push, deps, store, card } = await asked()
    store.inbox.edit(
      card.id,
      { ...cardOf(card), actionArgs: { argv: 'x' }, digest: card.digest },
      60
    )
    expect(await attemptAction(deps, approve(card))).toMatchObject({
      outcome: 'failed',
      detail: 'usage: push …'
    })
    expect(push.run).not.toHaveBeenCalled()
  })
})

// R-P5: push and post_review are only ever offered prepared, so a run without the power can't be asked about
// first. attemptAction never throws: the refusal is returned and recorded, and no card is filed.
describe('a run without the power trying an evidence-needing action', () => {
  it.each(['push', 'post_review'])('gets a recorded refusal for %s, and no card', async (name) => {
    const { push, deps, inbox } = setup(['commit'])
    const evidence: ActionEntry = { ...push, name, power: 'push', run: vi.fn() }
    const catalog: ActionCatalog = {
      entries: () => [evidence],
      get: (n) => (n === name ? evidence : null)
    }
    const result = await attemptAction({ ...deps, catalog }, { ...REQ, action: name })
    expect(result).toMatchObject({
      outcome: 'failed',
      detail: expect.stringContaining(`${name} needs prepared evidence`)
    })
    expect(evidence.run).not.toHaveBeenCalled()
    expect(deps.store.actions.forRun('run-1')).toMatchObject([{ action: name, status: 'refused' }])
    expect(inbox.store.inbox.list()).toEqual([])
  })
})

describe('proposalProblem', () => {
  it.each([
    [['push'], 'publish', REQ.args, null],
    [
      ['commit'],
      'publish',
      REQ.args,
      '"Fix CI" doesn\'t have the push power, so it can\'t propose publish'
    ],
    [['push'], 'deploy', {}, 'No action named "deploy" in Pilot\'s catalog'],
    [['push'], 'publish', { argv: 1 }, 'usage: push …']
  ])('with powers %j, %s %j → %s', (powers, action, args, problem) => {
    const { deps } = setup(powers)
    expect(proposalProblem(deps.catalog, deps.definitions()[0], action, args)).toBe(problem)
  })

  it('never lets an automation propose an approval-only action', () => {
    const { deps } = setup(['push'])
    const start = {
      name: 'start_run',
      power: null,
      checkArgs: () => null
    } as unknown as ActionEntry
    const catalog: ActionCatalog = { entries: () => [start], get: () => start }
    expect(proposalProblem(catalog, deps.definitions()[0], 'start_run', {})).toBe(
      "start_run needs a person's approval; only Pilot asks for it"
    )
  })
})

describe('refreshAction', () => {
  it('asks the entry for new pinned args and records the refresh', async () => {
    const { store, deps } = setup(['push'])
    expect(
      await refreshAction(deps, {
        action: 'publish',
        args: REQ.args,
        runId: 'run-1',
        inboxItemId: 'in_x'
      })
    ).toEqual({ args: { argv: ['/wt', 'web-1', 'ffff', 'bbb'] }, changed: 'head moved to ffff' })
    expect(store.actions.forInboxItem('in_x')).toMatchObject([{ phase: 'refresh', status: 'done' }])
  })

  it("refreshes nothing for args that don't fit, and keeps refreshed args that don't", async () => {
    const { push, deps } = setup(['push'])
    expect(
      await refreshAction(deps, {
        action: 'publish',
        args: { argv: 1 },
        runId: 'run-1',
        inboxItemId: 'in_x'
      })
    ).toBeNull()
    expect(push.refresh).not.toHaveBeenCalled()
    vi.mocked(push.refresh!).mockResolvedValueOnce({ args: { argv: 2 }, changed: 'x' })
    expect(
      await refreshAction(deps, {
        action: 'publish',
        args: REQ.args,
        runId: 'run-1',
        inboxItemId: 'in_x'
      })
    ).toBeNull()
  })
})
