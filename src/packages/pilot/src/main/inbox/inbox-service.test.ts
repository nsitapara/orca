import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { InboxAddParams } from '../../shared/inbox-types'
import { parsePeopleYaml } from '../../shared/people'
import { PilotStore } from '../store/store'
import { addInboxItem, CHANGED_AFTER_ANSWER, SKIPPED_BEFORE } from './inbox-add'
import {
  listInbox,
  replyToInboxItem,
  resolveInboxItem,
  syncRunWaiting,
  type InboxDeps
} from './inbox-service'

const def = parseAutomationYaml(
  'name: Fix CI\nrepo: web-platform\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: "{mr.author}"\n',
  '/a/ci.yaml'
)
const people = parsePeopleYaml(
  'people:\n  - { id: nish, name: Nish, gitlab: nish8 }\n  - { id: emil, name: Emil, gitlab: shivan2418 }\ngroups:\n  - { id: web, name: Web, members: [nish, emil] }\n'
)
if (!def.ok || !people.ok) {
  throw new Error('setup')
}

const QUESTION: InboxAddParams = {
  runId: 'run-1',
  type: 'question',
  title: 'Install LibreOffice in the job?',
  context: 'Carrier tests need it.',
  options: [
    'Install in the job — ~67 s per run',
    'Bake it into the image — needs a platform change'
  ]
}

function setup(author = 'nish8') {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-inbox-')), 'db.sqlite'))
  const tickId = store.startTick('ci', 1)
  const decision = {
    key: 'mr:1561',
    label: '!1561 web-1493',
    verdict: 'started' as const,
    reason: '',
    checks: [],
    onceKey: '1561:9',
    fields: { 'mr.author': author, 'mr.branch': 'web-1493-a' }
  }
  store.recordDecisions(tickId, [decision], new Map([['mr:1561', 'run-1']]))
  store.runs.create({
    id: 'run-1',
    automationId: 'ci',
    tickId,
    itemKey: 'mr:1561',
    itemLabel: '!1561 web-1493',
    worktreePath: '/wt/1493',
    startedAt: 1
  })
  let n = 0
  const onResolved = vi.fn()
  const deps: InboxDeps = {
    store,
    now: () => 100,
    definitions: () => [def.ok ? def.definition : (null as never)],
    people: () => (people.ok ? people.directory : (null as never)),
    newId: () => `in_${String(++n).padStart(16, '0')}`,
    onResolved
  }
  return { store, deps, onResolved }
}

describe('addInboxItem', () => {
  it('adds a card for the run: its item, worktree and the person its inbox names', () => {
    const { store, deps } = setup('shivan2418')
    expect(addInboxItem(deps, QUESTION)).toEqual({
      id: 'in_0000000000000001',
      existing: false,
      refused: null
    })
    expect(store.inbox.get('in_0000000000000001')).toMatchObject({
      automationId: 'ci',
      runId: 'run-1',
      itemKey: 'mr:1561',
      worktreePath: '/wt/1493',
      person: 'emil',
      status: 'open',
      version: 1,
      source: 'engine',
      options: [
        { label: 'Install in the job', meaning: '~67 s per run' },
        { label: 'Bake it into the image', meaning: 'needs a platform change' }
      ]
    })
    expect(store.events.list({ runId: 'run-1', kinds: ['item_written'] })).toHaveLength(1)
  })

  it('takes worktree, automation and item from the run only, ignoring what the caller names', () => {
    const { store, deps } = setup()
    addInboxItem(deps, {
      ...QUESTION,
      worktreePath: '/wt/other',
      automationId: 'x',
      itemKey: 'mr:9'
    })
    expect(store.inbox.get('in_0000000000000001')).toMatchObject({
      automationId: 'ci',
      itemKey: 'mr:1561',
      worktreePath: '/wt/1493'
    })
  })

  it('files a job-wide card only under a worktree its automation knows', () => {
    const { store, deps } = setup()
    const wide = { ...QUESTION, runId: undefined, automationId: 'ci', itemKey: 'mr:1561' }
    expect(() => addInboxItem(deps, { ...wide, worktreePath: '/wt/elsewhere' })).toThrow(
      '"/wt/elsewhere" is not a worktree of ci'
    )
    store.recordDecisions(
      store.startTick('ci', 5),
      [
        {
          key: 'mr:1561',
          label: 'x',
          verdict: 'started' as const,
          reason: '',
          checks: [],
          onceKey: '1561:9',
          fields: { 'worktree.path': '/wt/known' }
        }
      ],
      new Map()
    )
    addInboxItem(deps, { ...wide, worktreePath: '/wt/known' })
    expect(store.inbox.get('in_0000000000000001')?.worktreePath).toBe('/wt/known')
  })

  it('refuses a step that is not on the run, and accepts one that is', () => {
    const { store, deps } = setup()
    expect(() => addInboxItem(deps, { ...QUESTION, stepIdx: 3 })).toThrow('Run run-1 has no step 3')
    store.runs.createStep({
      runId: 'run-1',
      idx: 0,
      name: 's',
      agent: 'claude',
      skill: null,
      mode: null,
      startedAt: 1
    })
    addInboxItem(deps, { ...QUESTION, stepIdx: 0 })
    expect(store.inbox.get('in_0000000000000001')?.stepIdx).toBe(0)
  })

  it('refreshes a changed suggestion without a new version', () => {
    const { store, deps } = setup()
    addInboxItem(deps, { ...QUESTION, suggested: 'A' })
    expect(addInboxItem(deps, { ...QUESTION, suggested: 'B' })).toMatchObject({ existing: true })
    expect(store.inbox.get('in_0000000000000001')).toMatchObject({
      suggested: 'B',
      version: 1,
      status: 'open'
    })
  })

  it('does not store a raw string as the person when nobody is known', () => {
    const { deps } = setup()
    const empty = { ...deps, people: () => ({ people: [], groups: [] }) as never }
    expect(() => addInboxItem(empty, QUESTION)).toThrow('No person to address the card to')
  })

  it('turns a finished run into "needs you" while its card is open', () => {
    const { store, deps } = setup()
    store.runs.update('run-1', { status: 'done', finishedAt: 50 })
    addInboxItem(deps, QUESTION)
    expect(store.runs.get('run-1')?.status).toBe('needs_you')
  })

  it('returns the open card when the same card is added again', () => {
    const { deps } = setup()
    addInboxItem(deps, QUESTION)
    expect(addInboxItem(deps, QUESTION)).toEqual({
      id: 'in_0000000000000001',
      existing: true,
      refused: null
    })
  })

  it('makes a changed card a new version and clears an answer given to the old one', () => {
    const { store, deps } = setup()
    addInboxItem(deps, QUESTION)
    store.inbox.update(
      'in_0000000000000001',
      {
        status: 'answered',
        answer: { option: 0, text: 'Install in the job', digest: 'old', via: 'page' }
      },
      100
    )
    store.queue.enqueue('in_0000000000000001', 300, 100)
    addInboxItem(deps, {
      ...QUESTION,
      context: 'Carrier tests need it, and the e2e image is shared.'
    })
    expect(store.inbox.get('in_0000000000000001')).toMatchObject({
      version: 2,
      status: 'open',
      answer: null,
      replies: [{ text: CHANGED_AFTER_ANSWER, by: 'pilot' }]
    })
    expect(store.queue.forInboxItem('in_0000000000000001')).toEqual([])
  })

  it('refuses an action skipped before with the same pinned arguments', () => {
    const { deps } = setup()
    const push: InboxAddParams = {
      runId: 'run-1',
      type: 'action',
      title: 'Push?',
      options: ['Approve — push', 'Skip — keep'],
      action: 'publish',
      actionArgs: { argv: ['/wt/1493', 'b', 'aaa', 'bbb'] }
    }
    addInboxItem(deps, push)
    resolveInboxItem(deps, 'in_0000000000000001', 'skipped')
    expect(addInboxItem(deps, push)).toEqual({ id: null, existing: false, refused: SKIPPED_BEFORE })
    expect(
      addInboxItem(deps, { ...push, actionArgs: { argv: ['/wt/1493', 'b', 'ccc', 'bbb'] } }).id
    ).toBe('in_0000000000000002')
  })

  // Only the same action's card is edited in place: an open card never turns into an ask for another action,
  // and a start_run card (Pilot's ask-first ask, one per run) never merges with any other card.
  it.each<[string, Partial<InboxAddParams>, Partial<InboxAddParams>]>([
    [
      'a card for another action',
      { action: 'publish', actionArgs: { argv: ['a'] } },
      { action: 'mark_ready', actionArgs: { argv: ['1561', 'abc'] } }
    ],
    [
      "an agent's card where Pilot's ask-first card is open",
      { action: 'start_run', actionArgs: { run_id: 'run-1' } },
      { action: 'start_run', actionArgs: { run_id: 'run-1' } }
    ],
    [
      "Pilot's ask-first card where an agent's card is open",
      { action: 'publish', actionArgs: { argv: ['a'] } },
      { action: 'start_run', actionArgs: { run_id: 'run-1' } }
    ],
    [
      'an action card where a question of that title is open',
      {},
      { action: 'publish', actionArgs: { argv: ['a'] } }
    ]
  ])('files %s as a new card, leaving the open one as it was', (_name, first, second) => {
    const { store, deps } = setup()
    const base: InboxAddParams = { runId: 'run-1', type: 'action', title: 'Go ahead?' }
    addInboxItem(deps, { ...base, ...first })
    const before = store.inbox.get('in_0000000000000001')
    expect(addInboxItem(deps, { ...base, ...second })).toMatchObject({
      id: 'in_0000000000000002',
      existing: false
    })
    expect(store.inbox.get('in_0000000000000001')).toEqual(before)
  })

  it('still edits the open card of the same action in place', () => {
    const { store, deps } = setup()
    const push: InboxAddParams = {
      runId: 'run-1',
      type: 'action',
      title: 'Push?',
      action: 'publish',
      actionArgs: { argv: ['a'] }
    }
    addInboxItem(deps, push)
    expect(addInboxItem(deps, { ...push, actionArgs: { argv: ['b'] } })).toMatchObject({
      id: 'in_0000000000000001',
      existing: true
    })
    expect(store.inbox.get('in_0000000000000001')).toMatchObject({
      version: 2,
      actionArgs: { argv: ['b'] }
    })
  })

  it('needs an automation and item outside a run', () => {
    const { deps } = setup()
    expect(() => addInboxItem(deps, { ...QUESTION, runId: undefined })).toThrow(
      'Outside a run, --automation and --item are required'
    )
    expect(
      addInboxItem(deps, { ...QUESTION, runId: undefined, automationId: 'ci', itemKey: 'mr:1561' })
        .id
    ).toBe('in_0000000000000001')
  })

  it('refuses an action the catalog does not know', () => {
    const { deps } = setup()
    const withCatalog = { ...deps, knownAction: (name: string) => name === 'publish' }
    expect(() =>
      addInboxItem(withCatalog, { ...QUESTION, type: 'action', action: 'deploy', actionArgs: {} })
    ).toThrow('No action named "deploy" in Pilot\'s catalog')
  })

  it("refuses action args that don't fit the action's schema", () => {
    const { store, deps } = setup()
    const withCatalog = {
      ...deps,
      knownAction: () => true,
      actionArgsProblem: (_name: string, args: Record<string, unknown>) =>
        Array.isArray(args.argv) ? null : 'usage: publish { "argv": [...] }'
    }
    const card = { ...QUESTION, type: 'action' as const, action: 'publish' }
    expect(() => addInboxItem(withCatalog, { ...card, actionArgs: { argv: 'x' } })).toThrow(
      'usage: publish { "argv": [...] }'
    )
    expect(store.inbox.list({})).toEqual([])
    expect(addInboxItem(withCatalog, { ...card, actionArgs: { argv: ['x'] } }).id).toBe(
      'in_0000000000000001'
    )
  })
})

describe('resolving and replying', () => {
  it.each([
    ['done: pushed web-1493 to 9c1e2f04', 'done'],
    ['obsolete: !1561 merged', 'obsolete'],
    ['stale: head moved to ffff0000', 'stale'],
    ['kept', 'done']
  ])('"%s" closes the card as %s', (outcome, status) => {
    const { store, deps, onResolved } = setup()
    addInboxItem(deps, QUESTION)
    resolveInboxItem(deps, 'in_0000000000000001', outcome)
    expect(store.inbox.get('in_0000000000000001')).toMatchObject({ status, outcome })
    expect(onResolved).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'in_0000000000000001', status })
    )
  })

  it('drops the pending answer and settles a "needs you" run once nothing is open', () => {
    const { store, deps } = setup()
    store.runs.update('run-1', { status: 'done', finishedAt: 50 })
    addInboxItem(deps, QUESTION)
    const queued = store.queue.enqueue('in_0000000000000001', 1, 1)
    store.queue.update(
      queued,
      { state: 'held', holdReason: 'typing', holdDetail: 'someone is typing in the tab' },
      1
    )
    resolveInboxItem(deps, 'in_0000000000000001', 'kept')
    expect(store.queue.forInboxItem('in_0000000000000001')).toEqual([])
    expect(store.runs.get('run-1')?.status).toBe('done')
  })

  it('reopens a card with the reply under it', () => {
    const { store, deps } = setup()
    addInboxItem(deps, QUESTION)
    store.inbox.update('in_0000000000000001', { status: 'answered' }, 100)
    replyToInboxItem(deps, 'in_0000000000000001', 'Which image: e2e or unit?')
    expect(store.inbox.get('in_0000000000000001')).toMatchObject({
      status: 'open',
      replies: [{ text: 'Which image: e2e or unit?', by: 'agent' }]
    })
  })

  it('refuses to tick a card twice', () => {
    const { deps } = setup()
    addInboxItem(deps, QUESTION)
    resolveInboxItem(deps, 'in_0000000000000001', 'kept')
    expect(() => resolveInboxItem(deps, 'in_0000000000000001', 'kept')).toThrow(
      'Inbox item in_0000000000000001 is already done'
    )
  })
})

describe('listInbox', () => {
  it("shows a person their own cards and their groups' cards", () => {
    const { store, deps } = setup()
    addInboxItem(deps, QUESTION)
    addInboxItem(deps, { ...QUESTION, title: 'For the team?' })
    store.inbox.update('in_0000000000000002', { person: 'web' }, 100)
    addInboxItem(deps, { ...QUESTION, title: 'For Emil?' })
    store.inbox.update('in_0000000000000003', { person: 'emil' }, 100)
    expect(listInbox(deps, { person: 'nish' }).items.map((i) => i.id)).toEqual([
      'in_0000000000000001',
      'in_0000000000000002'
    ])
    expect(listInbox(deps, {}).people).toEqual([
      { id: 'nish', name: 'Nish' },
      { id: 'emil', name: 'Emil' }
    ])
  })

  // Each action card's Run line comes from the builder it is given (run-line.ts), bound to the digest.
  it('gives each action card the Run line its builder makes, and none to the others', () => {
    const { deps } = setup()
    addInboxItem(deps, QUESTION)
    addInboxItem(deps, {
      ...QUESTION,
      type: 'action',
      title: 'Push?',
      action: 'publish',
      actionArgs: { argv: ['/wt/1493', 'b', 'c1', 'o1'] }
    })
    const lines = listInbox(deps, {}, (item) =>
      item.action ? { digest: item.digest, text: `run ${item.id}` } : null
    ).runLines
    expect(Object.keys(lines)).toEqual(['in_0000000000000002'])
    expect(lines.in_0000000000000002.text).toBe('run in_0000000000000002')
  })

  it("gives each card its Message history: the run that asked it and an agent's reply", () => {
    const { deps } = setup()
    addInboxItem(deps, QUESTION)
    replyToInboxItem(deps, 'in_0000000000000001', 'e2e or unit?')
    expect(listInbox(deps, {}).history).toEqual({
      in_0000000000000001: [
        { kind: 'asked', at: 100, run: { id: 'run-1', status: 'running' } },
        { kind: 'reply', at: 100, by: 'agent', text: 'e2e or unit?', run: null }
      ]
    })
  })

  // One card whose Run line can't be built still shows (without it); the rest keep theirs, and it is logged once.
  it("lists every card when one card's Run line can't be built", () => {
    const { deps } = setup()
    const push = {
      ...QUESTION,
      type: 'action' as const,
      action: 'publish',
      actionArgs: { argv: ['a'] }
    }
    addInboxItem(deps, { ...push, title: 'First?' })
    addInboxItem(deps, { ...push, title: 'Second?' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const payload = listInbox(deps, {}, (item) => {
      if (item.id === 'in_0000000000000001') {
        throw new Error('catalog read failed')
      }
      return { digest: item.digest, text: `run ${item.id}` }
    })
    expect(payload.items.map((i) => i.id)).toEqual(['in_0000000000000001', 'in_0000000000000002'])
    expect(payload.runLines).toEqual({
      in_0000000000000002: { digest: expect.any(String), text: 'run in_0000000000000002' }
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('in_0000000000000001')
    warn.mockRestore()
  })
})

describe('listInbox itemLabel', () => {
  const ref = (subject?: string) =>
    ({
      path: '/p.json',
      sha256: 'a'.repeat(64),
      inlined: {},
      blocks: 1,
      drafted: false,
      draftedBase: null,
      summary: [],
      ...(subject === undefined ? {} : { subject })
    }) as never
  const newCard = (id: string, over: Record<string, unknown>) =>
    ({
      id,
      automationId: 'ci',
      runId: null,
      stepIdx: null,
      itemKey: 'mr:1561',
      worktreePath: null,
      person: 'nish',
      type: 'action',
      title: id,
      context: '',
      options: [],
      suggested: null,
      detailsMd: null,
      action: null,
      actionArgs: null,
      digest: id,
      createdAt: 1,
      source: 'engine',
      vaultRef: null,
      ...over
    }) as never

  it('names the item from its own run, else the newest tick that listed it, else the Details MR row, else nothing', () => {
    const { store, deps } = setup()
    const snap = (subject: string) => ({
      ref: ref(subject),
      bundle: { version: 1, item: 'x', blocks: [] },
      texts: {}
    })
    store.inbox.add(newCard('from-run', { runId: 'run-1' }))
    store.inbox.add(newCard('from-tick', { runId: 'gone' }))
    store.inbox.add(
      newCard('from-facts', { itemKey: 'mr:1579', details: ref('!1579 web-2107-improve') }),
      snap('!1579 web-2107-improve') as never
    )
    store.inbox.add(newCard('none', { itemKey: 'mr:77' }))
    store.inbox.add(
      newCard('facts-not-mr', { itemKey: null, details: ref('!5 x') }),
      snap('!5 x') as never
    )
    const labels = Object.fromEntries(listInbox(deps, {}).items.map((i) => [i.id, i.itemLabel]))
    expect(labels).toEqual({
      'from-run': '!1561 web-1493',
      'from-tick': '!1561 web-1493',
      'from-facts': '!1579 web-2107-improve',
      none: undefined,
      'facts-not-mr': undefined
    })
  })

  it('reads the run and tick labels in one query each, not one per card', () => {
    const { store, deps } = setup()
    for (let i = 0; i < 5; i++) {
      store.inbox.add(newCard(`c${i}`, { runId: 'run-1' }))
    }
    const calls: string[] = []
    const db = (store as unknown as { db: { prepare: (sql: string) => unknown } }).db
    const prepare = db.prepare.bind(db)
    db.prepare = (sql: string) => {
      calls.push(sql)
      return prepare(sql)
    }
    listInbox(deps, {})
    // cardRuns reads each distinct run by id for the list's runs; the label read is the one that is not by id.
    expect(calls.filter((c) => /FROM runs/.test(c) && !/WHERE id = \?/.test(c))).toHaveLength(1)
    expect(calls.filter((c) => /FROM tick_items/.test(c))).toHaveLength(1)
  })
})

describe('listInbox answerStates', () => {
  const card = (id: string) =>
    ({
      id,
      automationId: 'ci',
      runId: null,
      stepIdx: null,
      itemKey: null,
      worktreePath: null,
      person: 'nish',
      type: 'action',
      title: id,
      context: '',
      options: [],
      suggested: null,
      detailsMd: null,
      action: null,
      actionArgs: null,
      digest: id,
      createdAt: 1,
      source: 'engine',
      vaultRef: null
    }) as never

  it('tells the page, per answered card, whether its answer is locked and where its row stands', () => {
    const { store, deps } = setup()
    const states = ['settling', 'held', 'ready', 'failed', 'none', 'sent', 'running'] as const
    for (const name of states) {
      store.inbox.add(card(name))
      const answer = { option: 0, text: 'approve', digest: name, via: 'page' as const }
      store.inbox.update(
        name,
        { status: 'answered', answer, answeredAt: 10, answeredBy: 'nish' },
        10
      )
    }
    store.inbox.add(card('open-one'))
    const row = (id: string, readyAt: number, patch: Record<string, unknown>) =>
      store.queue.update(store.queue.enqueue(id, readyAt, 10), patch as never, 10)
    row('settling', 500_000, {})
    row('held', 50, { state: 'held', holdReason: 'typing', holdDetail: 'someone is typing' })
    row('ready', 50, { state: 'ready' })
    row('failed', 50, { state: 'failed', holdReason: 'retry', holdDetail: 'no main checkout' })
    // Sent before Pilot took over (no run), and sent to an answer run that is still running.
    row('sent', 50, { state: 'dispatched' })
    store.runs.create({
      id: 'ans-1',
      automationId: 'ci',
      tickId: null,
      itemKey: 'mr:1',
      itemLabel: '!1',
      worktreePath: null,
      startedAt: 5,
      status: 'running',
      trigger: 'answer'
    })
    row('running', 50, { state: 'dispatched', dispatchedRunId: 'ans-1' })
    const { answerStates } = listInbox(deps, {})
    expect(answerStates).toEqual({
      settling: {
        locked: false,
        sentBeforePilot: false,
        state: 'not_ready',
        readyAt: 500_000,
        reason: null
      },
      held: {
        locked: false,
        sentBeforePilot: false,
        state: 'held',
        readyAt: 50,
        reason: 'someone is typing'
      },
      ready: { locked: true, sentBeforePilot: false, state: 'ready', readyAt: 50, reason: null },
      running: {
        locked: true,
        sentBeforePilot: false,
        state: 'dispatched',
        readyAt: 50,
        reason: null
      },
      sent: {
        locked: false,
        sentBeforePilot: true,
        state: 'dispatched',
        readyAt: 50,
        reason: null
      },
      failed: {
        locked: false,
        sentBeforePilot: false,
        state: 'failed',
        readyAt: 50,
        reason: 'no main checkout'
      },
      none: { locked: false, sentBeforePilot: false, state: null, readyAt: null, reason: null }
    })
  })

  it('reads the queue and the runs once for the whole list, not once per answered card', () => {
    const { store, deps } = setup()
    for (let i = 0; i < 6; i++) {
      const id = `c${i}`
      store.inbox.add(card(id))
      const answer = { option: 0, text: 'approve', digest: id, via: 'page' as const }
      store.inbox.update(id, { status: 'answered', answer, answeredAt: 10, answeredBy: 'nish' }, 10)
      store.queue.enqueue(id, 500_000, 10)
    }
    const calls: string[] = []
    const db = (store as unknown as { db: { prepare: (sql: string) => unknown } }).db
    const prepare = db.prepare.bind(db)
    db.prepare = (sql: string) => {
      calls.push(sql)
      return prepare(sql)
    }
    listInbox(deps, {})
    expect(calls.filter((c) => /FROM queue/.test(c))).toHaveLength(1)
    expect(calls.filter((c) => /FROM runs/.test(c)).length).toBeLessThanOrEqual(2)
  })
})

describe('managed inbox intake', () => {
  it('preserves the first immutable decision, including a saved early answer, across changed re-submissions', () => {
    const { deps, store } = setup()
    const preparation = {
      key: 'ci:dependency',
      context: 'Reproduce the image dependency failure using the pinned job log.',
      requirements: ['context'] as const
    }
    const request = {
      ...QUESTION,
      preparation: { ...preparation, requirements: [...preparation.requirements] }
    }
    const first = addInboxItem(deps, request)
    const item = store.inbox.get(first.id!)!
    store.inbox.saveAnswer(
      item.id,
      { text: 'Leave this to me', option: null, digest: item.digest, via: 'page' },
      'nish',
      101
    )
    expect(
      addInboxItem(deps, { ...request, title: 'Changed title', context: 'new facts' })
    ).toEqual({ id: item.id, existing: true, refused: null })
    expect(store.inbox.get(item.id)).toMatchObject({
      title: QUESTION.title,
      status: 'answered',
      preparation: { state: 'cancelled' },
      answer: { text: 'Leave this to me' }
    })
    expect(store.inbox.list()).toHaveLength(1)
    expect(store.inboxPreparations.listEligible(102)).toEqual([])
    expect(() => store.inboxPreparations.claim(item.id, 1, 'worker', 0, 102)).toThrow('stale')
  })
})

// M1: the key (and a plain card's identity) matches waiting cards only: a repeat after the old card closed is a new card.
it.each(['prepared', 'plain'] as const)(
  'asks a %s question again as a new card once the old one has closed',
  (kind) => {
    const { deps, store } = setup()
    const request =
      kind === 'prepared'
        ? {
            ...QUESTION,
            preparation: { key: 'q', context: 'Pinned', requirements: ['context' as const] }
          }
        : QUESTION
    const first = addInboxItem(deps, request).id!
    resolveInboxItem(deps, first, 'done: answered elsewhere')
    const again = addInboxItem(deps, request)
    expect(again).toMatchObject({ existing: false, refused: null })
    expect(again.id).not.toBe(first)
    expect(store.inbox.get(again.id!)?.status).toBe('open')
  }
)

// M6 (Ruling 2): the list carries a light ref. A prepared card lists its state, attempt, progress, error and needs,
// never its request context (up to 64 KB) or its artifact manifest; those come with `pilot inbox show` and Details.
it('lists a prepared card with a light preparation ref and no manifest', () => {
  const { deps, store } = setup()
  const context = 'x'.repeat(60_000)
  const id = addInboxItem(deps, {
    ...QUESTION,
    preparation: { key: 'k', context, requirements: ['context', 'diff'] }
  }).id!
  const manifest = {
    files: [{ ref: 'F2.patch', role: 'patch' as const, sha256: '1'.repeat(64), bytes: 9 }],
    expected: ['context'],
    generated: ['context'],
    tags: []
  }
  const details = {
    path: '/b.json',
    sha256: '0'.repeat(64),
    inlined: {},
    blocks: 1,
    drafted: false,
    draftedBase: null,
    summary: [],
    artifacts: manifest
  }
  store.inbox.edit(id, { details, digest: 'd'.repeat(64) }, 100)
  const [row] = listInbox(deps, {}).items
  expect(row.preparation).toEqual({
    state: 'queued',
    revision: 1,
    attempt: 0,
    maxAttempts: 3,
    progress: 'Context queued',
    error: null,
    updatedAt: 100,
    input: { requirements: ['context', 'diff'] }
  })
  expect(JSON.stringify(row)).not.toContain('xxxxxxxx')
  expect(row.details).not.toHaveProperty('artifacts')
  expect(store.inbox.get(id)?.preparation?.input.context).toBe(context)
  expect(store.inbox.get(id)?.details?.artifacts).toEqual(manifest)
})

it('uses the stable decision key rather than a repeated display title for managed items', () => {
  const { deps, store } = setup()
  for (const key of ['first-decision', 'second-decision']) {
    addInboxItem(deps, {
      ...QUESTION,
      preparation: { key, context: 'Self-contained context', requirements: ['context'] }
    })
  }
  expect(store.inbox.list()).toHaveLength(2)
})

describe('syncRunWaiting', () => {
  it('moves a needs_you run whose last open cards are defaults back to done, with a plain Done outcome', () => {
    const { store, deps } = setup()
    addInboxItem(deps, { runId: 'run-1', type: 'default', title: 'Keep x? → yes', context: 'c' })
    store.runs.update('run-1', {
      status: 'needs_you',
      outcome: 'Inbox: 2 open items',
      finishedAt: 5
    })
    syncRunWaiting(store, 'run-1', 9)
    expect(store.runs.get('run-1')).toMatchObject({
      status: 'done',
      outcome: 'Done',
      finishedAt: 5
    })
    store.close()
  })
})
