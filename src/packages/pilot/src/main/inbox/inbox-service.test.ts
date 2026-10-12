import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { InboxAddParams } from '../../shared/inbox-types'
import { parsePeopleYaml } from '../../shared/people'
import { PilotStore } from '../store/store'
import { addInboxItem, CHANGED_AFTER_ANSWER, SKIPPED_BEFORE } from './inbox-add'
import { listInbox, replyToInboxItem, resolveInboxItem, type InboxDeps } from './inbox-service'

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
  const tickId = store.startTick('ci', false, 1)
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
      store.startTick('ci', false, 5),
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
      replies: [CHANGED_AFTER_ANSWER]
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
      action: 'push',
      actionArgs: { argv: ['/wt/1493', 'b', 'aaa', 'bbb'] }
    }
    addInboxItem(deps, push)
    resolveInboxItem(deps, 'in_0000000000000001', 'skipped')
    expect(addInboxItem(deps, push)).toEqual({ id: null, existing: false, refused: SKIPPED_BEFORE })
    expect(
      addInboxItem(deps, { ...push, actionArgs: { argv: ['/wt/1493', 'b', 'ccc', 'bbb'] } }).id
    ).toBe('in_0000000000000002')
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
    const withCatalog = { ...deps, knownAction: (name: string) => name === 'push' }
    expect(() =>
      addInboxItem(withCatalog, { ...QUESTION, type: 'action', action: 'deploy', actionArgs: {} })
    ).toThrow('No action named "deploy" in Pilot\'s catalog')
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
      replies: ['Which image: e2e or unit?']
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
})
