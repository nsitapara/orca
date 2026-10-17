import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { InboxAnswer } from '../../shared/api-types'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { InboxAddParams } from '../../shared/inbox-types'
import { parsePeopleYaml } from '../../shared/people'
import type { AttemptDeps } from '../actions/attempt'
import type { ActionEntry, ActionResult } from '../actions/types'
import { addReady } from '../inbox/__fixtures__/prepared'
import type { InboxDeps } from '../inbox/inbox-service'
import { PilotStore } from '../store/store'
import { applyScript, CARD_CHANGED, INTERRUPTED_AGAIN } from './apply-script'
import { APPROVE_ON_DESKTOP, saveAnswer } from './save'

const def = parseAutomationYaml(
  'name: Fix CI\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\npowers: [push]\ninbox: nish\n',
  '/a/ci.yaml'
)
const people = parsePeopleYaml('people:\n  - { id: nish, name: Nish }\n')
if (!def.ok || !people.ok) {
  throw new Error('setup')
}
const DONE: ActionResult = {
  outcome: 'done',
  detail: 'pushed web-1 to 9c1e2f04',
  link: 'https://x',
  log: '/l',
  onYou: false
}
const PUSH: InboxAddParams = {
  runId: 'run-1',
  type: 'action',
  title: 'Push?',
  context: 'Fixed it.',
  options: ['Approve — push', 'Skip — keep'],
  action: 'push',
  actionArgs: { argv: ['/wt', 'web-1', 'aaaa', 'bbbb'] }
}
const ID = 'in_0000000000000001'

function setup(
  result: ActionResult = DONE,
  card: InboxAddParams = PUSH,
  refresh: ActionEntry['refresh'] = async () => null
) {
  const store = PilotStore.open(
    join(mkdtempSync(join(tmpdir(), 'pilot-apply-script-')), 'db.sqlite')
  )
  store.runs.create({
    id: 'run-1',
    automationId: 'ci',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1',
    worktreePath: '/wt',
    startedAt: 1
  })
  const entry: ActionEntry = {
    name: card.action!,
    power: 'push',
    label: 'x',
    usage: 'x',
    checkArgs: (args) => (Array.isArray(args.argv) ? null : 'usage: x'),
    describe: async () => 'x',
    run: vi.fn().mockResolvedValue(result),
    refresh: vi.fn(refresh),
    exceptArgs: (args, leftOut) => ({
      ...args,
      argv: [...(args.argv as string[]), '--except', leftOut.join(',')]
    })
  }
  let clock = 100
  const inbox: InboxDeps = {
    store,
    now: () => clock,
    definitions: () => [def.ok ? def.definition : (null as never)],
    people: () => (people.ok ? people.directory : (null as never)),
    newId: () => ID
  }
  const catalog = { entries: () => [entry], get: (n: string) => (n === entry.name ? entry : null) }
  const attempt: AttemptDeps = {
    store,
    now: () => clock,
    catalog,
    definitions: inbox.definitions,
    inbox
  }
  addReady(inbox, card)
  const item = () => store.inbox.get(ID)!
  // Approvals come only from Pilot's desktop app (the transport's caller kind).
  const approve = (text = 'approve') =>
    saveAnswer(inbox, { id: ID, text, digest: item().digest }, { callerKind: 'desktop', catalog })
  // An answer saved some other way (an import, an older record): written straight to the card.
  const stored = (answer: Partial<InboxAnswer>) =>
    store.inbox.update(
      ID,
      {
        status: 'answered',
        answer: { option: null, text: 'approve', digest: item().digest, via: 'page', ...answer }
      },
      100
    )
  return {
    store,
    entry,
    deps: { inbox, attempt },
    item,
    approve,
    stored,
    tick: (ms: number) => (clock += ms)
  }
}

describe('applyScript', () => {
  it("runs a desktop approval through the card path, with the card's own args, and closes it", async () => {
    const { store, entry, deps, item, approve } = setup()
    approve()
    const digest = item().digest
    expect(await applyScript(deps, item(), [])).toEqual({ kind: 'done' })
    expect(entry.run).toHaveBeenCalledWith(PUSH.actionArgs, {
      dryRun: false,
      runId: 'run-1',
      inboxItemId: ID
    })
    expect(store.actions.forInboxItem(ID)).toMatchObject([
      { phase: 'do', status: 'done', digest, args: PUSH.actionArgs }
    ])
    expect(item()).toMatchObject({
      status: 'done',
      outcome: 'done: pushed web-1 to 9c1e2f04 · https://x'
    })
  })

  it.each<[string, (s: ReturnType<typeof setup>) => void, string]>([
    [
      'an approval from a paired device',
      (s) => s.stored({ callerKind: 'paired-device' }),
      APPROVE_ON_DESKTOP
    ],
    [
      'an approval with no caller recorded (an import)',
      (s) => s.stored({ via: 'import' }),
      APPROVE_ON_DESKTOP
    ],
    [
      'a card that changed after the approval',
      (s) => {
        s.approve()
        s.store.inbox.edit(ID, { context: 'Fixed it, and more.', digest: 'e'.repeat(64) }, 100)
      },
      CARD_CHANGED
    ]
  ])('re-asks %s and runs nothing', async (_name, arrange, reply) => {
    const s = setup()
    arrange(s)
    expect(await applyScript(s.deps, s.item(), [])).toEqual({ kind: 'reasked' })
    expect(s.entry.run).not.toHaveBeenCalled()
    expect(s.store.actions.forInboxItem(ID)).toEqual([])
    expect(s.item()).toMatchObject({
      status: 'open',
      answer: null,
      replies: [{ text: reply, by: 'pilot' }]
    })
  })

  it('re-asks an approval whose action a stop interrupted, then runs a new approval', async () => {
    const s = setup()
    s.approve()
    s.tick(10)
    s.store.actions.start({
      inboxItemId: ID,
      runId: 'run-1',
      action: 'push',
      args: PUSH.actionArgs!,
      digest: s.item().digest,
      phase: 'do',
      dryRun: false,
      startedAt: 110
    })
    s.store.actions.interruptRunning(200, 200, () => true)
    expect(await applyScript(s.deps, s.item(), [])).toEqual({ kind: 'reasked' })
    expect(s.entry.run).not.toHaveBeenCalled()
    expect(s.item()).toMatchObject({
      status: 'open',
      replies: [{ text: INTERRUPTED_AGAIN, by: 'pilot' }]
    })
    s.tick(1_000)
    s.approve()
    expect(await applyScript(s.deps, s.item(), [])).toEqual({ kind: 'done' })
    expect(s.entry.run).toHaveBeenCalledTimes(1)
  })

  it('keeps a not-yet approval standing and says what it waits for', async () => {
    const { deps, item, approve } = setup({
      ...DONE,
      outcome: 'not_yet',
      detail: '1 open thread',
      onYou: true
    })
    approve()
    expect(await applyScript(deps, item(), [])).toEqual({
      kind: 'waits',
      reason: '1 open thread (waits on you)'
    })
    expect(item().status).toBe('answered')
  })

  it('asks again, pinned to the new state, when a stale action can be refreshed', async () => {
    const { deps, entry, item, approve } = setup(
      { ...DONE, outcome: 'stale', detail: 'head moved to ffff0000' },
      PUSH,
      async () => ({
        args: { argv: ['/wt', 'web-1', 'ffff', 'bbbb'] },
        changed: 'the head moved to ffff'
      })
    )
    approve()
    expect(await applyScript(deps, item(), [])).toEqual({ kind: 'reasked' })
    expect(entry.refresh).toHaveBeenCalledWith(PUSH.actionArgs)
    expect(item()).toMatchObject({
      status: 'open',
      version: 2,
      answer: null,
      actionArgs: { argv: ['/wt', 'web-1', 'ffff', 'bbbb'] },
      context:
        'The head moved to ffff since you approved; approve this version to go ahead. Fixed it.'
    })
  })

  it('closes a stale action that cannot be refreshed', async () => {
    const { deps, item, approve } = setup({
      ...DONE,
      outcome: 'stale',
      detail: 'head moved to ffff0000',
      link: null
    })
    approve()
    await applyScript(deps, item(), [])
    expect(item()).toMatchObject({ status: 'stale', outcome: 'stale: head moved to ffff0000' })
  })

  // Spec E: a push pilotcli skipped (a pin moved, not a fast-forward, not mine) leaves its card open with why.
  it('re-asks a stale action that keeps its card open, with why, and never refreshes it', async () => {
    const { deps, entry, item, approve } = setup({
      ...DONE,
      outcome: 'stale',
      detail: 'not pushed: stale: HEAD is now 7f00aa1',
      link: null,
      keepOpen: true
    })
    approve()
    expect(await applyScript(deps, item(), [])).toEqual({ kind: 'reasked' })
    expect(entry.refresh).not.toHaveBeenCalled()
    expect(item()).toMatchObject({ status: 'open', answer: null, outcome: null })
    expect(item().replies.at(-1)).toEqual({
      text: 'not pushed: stale: HEAD is now 7f00aa1',
      by: 'pilot'
    })
  })

  it('closes a done action that carries keepOpen, since only a stale result keeps its card open', async () => {
    const { deps, item, approve } = setup({ ...DONE, keepOpen: true })
    approve()
    expect(await applyScript(deps, item(), [])).not.toEqual({ kind: 'reasked' })
    expect(item().status).not.toBe('open')
  })

  it('hands an action that needs judgement to the agent', async () => {
    const { deps, item, approve } = setup({
      ...DONE,
      outcome: 'needs_agent',
      detail: 'it conflicts'
    })
    approve()
    expect(await applyScript(deps, item(), [])).toEqual({ kind: 'agent', note: 'it conflicts' })
  })

  it('names the log of a failed action', async () => {
    const { deps, item, approve } = setup({
      ...DONE,
      outcome: 'failed',
      detail: 'push refused',
      link: null
    })
    approve()
    await applyScript(deps, item(), [])
    expect(item().outcome).toBe('failed: push refused · log /l')
  })

  it('passes the parts left out and counts each part', async () => {
    const post = {
      ...PUSH,
      action: 'post_review',
      actionArgs: { argv: ['1579', 'f.json', 'abc'] },
      parts: { F1: 'Null check', F2: 'Naming' }
    }
    const { entry, deps, item, approve } = setup(DONE, post)
    approve('approve except: F2')
    await applyScript(deps, item(), ['F2'])
    expect(entry.run).toHaveBeenCalledWith(
      { argv: ['1579', 'f.json', 'abc', '--except', 'F2'] },
      { dryRun: false, runId: 'run-1', inboxItemId: ID }
    )
    expect(item().outcome).toBe('done: 1 done · 1 left out')
  })
})
