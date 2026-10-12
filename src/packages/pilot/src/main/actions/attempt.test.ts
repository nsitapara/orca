import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { parsePeopleYaml } from '../../shared/people'
import { cardOf } from '../inbox/card'
import { addInboxItem } from '../inbox/inbox-add'
import type { InboxDeps } from '../inbox/inbox-service'
import { PilotStore } from '../store/store'
import { attemptAction, refreshAction } from './attempt'
import { proposalProblem } from './powers'
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
    name: 'push',
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
  const catalog: ActionCatalog = { entries: () => [push], get: (n) => (n === 'push' ? push : null) }
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

const REQ = {
  action: 'push',
  args: { argv: ['/wt', 'web-1', 'aaa', 'bbb'] },
  dryRun: false,
  runId: 'run-1',
  inboxItemId: null,
  approved: false
}

describe('attemptAction', () => {
  it('runs an action the run has the power for, and records it', async () => {
    const { store, push, deps } = setup(['commit', 'push'])
    expect(await attemptAction(deps, REQ)).toMatchObject({
      outcome: 'done',
      detail: 'pushed web-1 to 9c1e2f04'
    })
    expect(push.run).toHaveBeenCalledWith(REQ.args, { dryRun: false, runId: 'run-1' })
    expect(store.actions.forRun('run-1')).toMatchObject([
      { action: 'push', phase: 'do', status: 'done', dryRun: false, finishedAt: 50 }
    ])
    expect(store.events.list({ runId: 'run-1', kinds: ['action_run'] })).toHaveLength(1)
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
      action: 'push',
      actionArgs: REQ.args,
      person: 'nish',
      runId: 'run-1'
    })
    expect(store.actions.forInboxItem('in_0000000000000001')).toMatchObject([
      { action: 'push', status: 'refused', runId: 'run-1' }
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
    await attemptAction(deps, { ...REQ, stepIdx: 0, args: { argv: [...REQ.args.argv] } })
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
      'Outside a Pilot run, approve actions in Pilot (Waiting on you), or run act.py directly.'
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
    expect(push.run).toHaveBeenCalledWith(REQ.args, { dryRun: true, runId: null })
  })

  it("runs a person's own approved call (no run, no card) without powers", async () => {
    const { push, deps } = setup()
    expect(await attemptAction(deps, { ...REQ, runId: null, approved: true })).toMatchObject({
      outcome: 'done'
    })
    expect(push.run).toHaveBeenCalled()
  })
})

describe('attemptAction on an approved card', () => {
  async function asked(powers?: string[]) {
    const s = setup(powers)
    await attemptAction(s.deps, REQ)
    return { ...s, card: s.store.inbox.get('in_0000000000000001')! }
  }

  it('runs a card Pilot asked about, without the power: the approval is the go-ahead', async () => {
    const { push, deps, card } = await asked()
    const result = await attemptAction(deps, {
      ...REQ,
      approved: true,
      inboxItemId: card.id,
      digest: card.digest
    })
    expect(result).toMatchObject({ outcome: 'done' })
    expect(push.run).toHaveBeenCalledWith(REQ.args, { dryRun: false, runId: 'run-1' })
  })

  it("runs a card the automation filed itself while it has the action's power", async () => {
    const { push, deps, inbox } = setup(['push'])
    const id = addInboxItem(inbox, {
      runId: 'run-1',
      type: 'action',
      title: 'Push?',
      action: 'push',
      actionArgs: REQ.args
    }).id!
    expect(await attemptAction(deps, { ...REQ, approved: true, inboxItemId: id })).toMatchObject({
      outcome: 'done'
    })
    expect(push.run).toHaveBeenCalled()
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
    ]
  ])('refuses %s', async (_name, change, detail) => {
    const { push, deps, card } = await asked()
    const result = await attemptAction(deps, {
      ...REQ,
      approved: true,
      inboxItemId: card.id,
      ...change(card.id)
    })
    expect(result).toMatchObject({ outcome: 'failed', detail })
    expect(push.run).not.toHaveBeenCalled()
  })

  it('refuses a closed card', async () => {
    const { push, deps, store, card } = await asked()
    store.inbox.update(card.id, { status: 'done', outcome: 'skipped' }, 60)
    expect(
      await attemptAction(deps, { ...REQ, approved: true, inboxItemId: card.id })
    ).toMatchObject({ outcome: 'failed', detail: 'Card in_0000000000000001 is already done' })
    expect(push.run).not.toHaveBeenCalled()
  })

  it('refuses a card whose action differs from the one asked for', async () => {
    const { push, deps, card } = await asked()
    const other: ActionEntry = { ...push, name: 'mark_ready', power: 'mark_ready', run: vi.fn() }
    const catalog: ActionCatalog = {
      entries: () => [push, other],
      get: (n) => [push, other].find((e) => e.name === n) ?? null
    }
    const result = await attemptAction(
      { ...deps, catalog },
      { ...REQ, action: 'mark_ready', approved: true, inboxItemId: card.id }
    )
    expect(result).toMatchObject({
      outcome: 'failed',
      detail: 'Card in_0000000000000001 is for push, not mark_ready'
    })
    expect(other.run).not.toHaveBeenCalled()
  })

  it("refuses a card its automation filed itself once the automation no longer has the action's power", async () => {
    const withPower = setup(['push'])
    const id = addInboxItem(withPower.inbox, {
      runId: 'run-1',
      type: 'action',
      title: 'Push?',
      action: 'push',
      actionArgs: REQ.args
    }).id!
    const without = { ...withPower.deps, definitions: setup().deps.definitions }
    const detail =
      "\"Fix CI\" doesn't have the push power and Pilot didn't ask for card in_0000000000000001; it can't run"
    expect(await attemptAction(without, { ...REQ, approved: true, inboxItemId: id })).toMatchObject(
      { outcome: 'failed', detail }
    )
    expect(withPower.store.actions.forInboxItem(id)).toMatchObject([{ status: 'refused' }])
    // Its own refusal is no ask: approving it again is refused again.
    expect(await attemptAction(without, { ...REQ, approved: true, inboxItemId: id })).toMatchObject(
      { outcome: 'failed', detail }
    )
    expect(withPower.push.run).not.toHaveBeenCalled()
  })

  it('refuses stored args that no longer fit the entry', async () => {
    const { push, deps, store, card } = await asked()
    store.inbox.edit(
      card.id,
      { ...cardOf(card), actionArgs: { argv: 'x' }, digest: card.digest },
      60
    )
    expect(
      await attemptAction(deps, {
        ...REQ,
        args: { argv: 'x' },
        approved: true,
        inboxItemId: card.id
      })
    ).toMatchObject({ outcome: 'failed', detail: 'usage: push …' })
    expect(push.run).not.toHaveBeenCalled()
  })
})

describe('proposalProblem', () => {
  it.each([
    [['push'], 'push', REQ.args, null],
    [
      ['commit'],
      'push',
      REQ.args,
      '"Fix CI" doesn\'t have the push power, so it can\'t propose push'
    ],
    [['push'], 'deploy', {}, 'No action named "deploy" in Pilot\'s catalog'],
    [['push'], 'push', { argv: 1 }, 'usage: push …']
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
        action: 'push',
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
        action: 'push',
        args: { argv: 1 },
        runId: 'run-1',
        inboxItemId: 'in_x'
      })
    ).toBeNull()
    expect(push.refresh).not.toHaveBeenCalled()
    vi.mocked(push.refresh!).mockResolvedValueOnce({ args: { argv: 2 }, changed: 'x' })
    expect(
      await refreshAction(deps, {
        action: 'push',
        args: REQ.args,
        runId: 'run-1',
        inboxItemId: 'in_x'
      })
    ).toBeNull()
  })
})
