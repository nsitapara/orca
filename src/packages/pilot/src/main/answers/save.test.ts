import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { parsePeopleYaml } from '../../shared/people'
import { addReady, markReady } from '../inbox/__fixtures__/prepared'
import { resolveInboxItem, type InboxDeps } from '../inbox/inbox-service'
import { PilotStore } from '../store/store'
import { routeOf } from './queue-view'
import {
  ANSWER_LOCKED,
  APPROVE_ON_DESKTOP,
  CARD_CHANGED_ON_SAVE,
  DRAFT_ON_DESKTOP,
  DRAFT_OPTION_ON_DESKTOP,
  LOCAL_CLI_NO_ANSWER,
  NO_ANSWER_CALLER,
  saveAnswer as save,
  SETTLE_MS,
  type AnswerOrigin
} from './save'

const catalog = { get: (name: string) => (name === 'push' || name === 'start_run' ? {} : null) }
const DESKTOP: AnswerOrigin = { callerKind: 'desktop', catalog }
const PHONE: AnswerOrigin = { callerKind: 'paired-device', catalog }
const saveAnswer = (deps: InboxDeps, params: Parameters<typeof save>[1], origin = DESKTOP) =>
  save(deps, params, origin)

const def = parseAutomationYaml(
  'name: Fix CI\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: nish\n',
  '/a/ci.yaml'
)
const people = parsePeopleYaml('people:\n  - { id: nish, name: Nish, gitlab: nish8 }\n')
if (!def.ok || !people.ok) {
  throw new Error('setup')
}

function setup(
  card: Record<string, unknown> = {
    type: 'question',
    title: 'Which image?',
    options: ['Install in the job — slow', 'Bake it — fast']
  }
) {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-save-')), 'db.sqlite'))
  store.runs.create({
    id: 'run-1',
    automationId: 'ci',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1',
    worktreePath: '/wt',
    startedAt: 1
  })
  let clock = 1_000
  const deps: InboxDeps = {
    store,
    now: () => clock,
    definitions: () => [def.ok ? def.definition : (null as never)],
    people: () => (people.ok ? people.directory : (null as never)),
    newId: () => 'in_0000000000000001'
  }
  addReady(deps, { runId: 'run-1', ...card } as never)
  const item = store.inbox.get('in_0000000000000001')!
  return { store, deps, digest: item.digest, advance: (ms: number) => (clock += ms) }
}

describe('saveAnswer', () => {
  it('saves a desktop answer against the version shown and queues it to settle for 180 s', () => {
    const { store, deps, digest } = setup()
    const saved = saveAnswer(deps, { id: 'in_0000000000000001', option: 1, digest })
    expect(saved).toMatchObject({
      status: 'answered',
      answer: { option: 1, text: 'Bake it', digest, via: 'page', callerKind: 'desktop' },
      answeredAt: 1_000,
      answeredBy: 'nish'
    })
    expect(store.queue.forInboxItem('in_0000000000000001')).toMatchObject([
      { state: 'not_ready', readyAt: 1_000 + SETTLE_MS }
    ])
    expect(store.events.list({ kinds: ['answer_saved'] })).toHaveLength(1)
  })

  it('replaces the queued row when the answer changes', () => {
    const { store, deps, digest, advance } = setup()
    saveAnswer(deps, { id: 'in_0000000000000001', option: 0, digest })
    advance(60_000)
    saveAnswer(deps, { id: 'in_0000000000000001', text: 'Bake it, and drop the job step', digest })
    expect(store.queue.forInboxItem('in_0000000000000001')).toMatchObject([
      { state: 'not_ready', readyAt: 61_000 + SETTLE_MS }
    ])
    expect(store.inbox.get('in_0000000000000001')?.answer?.text).toBe(
      'Bake it, and drop the job step'
    )
  })

  it.each<[string, AnswerOrigin, { digest?: string; option?: number }, string]>([
    ['a card that changed', DESKTOP, { digest: 'f'.repeat(64) }, CARD_CHANGED_ON_SAVE],
    ['a card that changed (device)', PHONE, { digest: 'f'.repeat(64) }, CARD_CHANGED_ON_SAVE],
    [
      'a desktop save that names no version',
      DESKTOP,
      {},
      'A page answer names the card version it answers'
    ],
    [
      'an option the card lacks',
      DESKTOP,
      { option: 5, digest: 'current' },
      "Option 6 isn't on this card"
    ]
  ])('refuses %s', (_name, origin, params, message) => {
    const { deps, digest } = setup()
    const given = { ...params, digest: params.digest === 'current' ? digest : params.digest }
    expect(() =>
      saveAnswer(deps, { id: 'in_0000000000000001', option: 0, ...given }, origin)
    ).toThrow(message)
  })

  it('refuses an answer on a closed card', () => {
    const { deps } = setup()
    resolveInboxItem(deps, 'in_0000000000000001', 'obsolete: !1 merged')
    expect(() => saveAnswer(deps, { id: 'in_0000000000000001', text: 'x' })).toThrow(
      'This card is obsolete; it takes no answer'
    )
  })

  it('takes a paired device answer as the current version, marked device', () => {
    const { deps, digest } = setup()
    expect(saveAnswer(deps, { id: 'in_0000000000000001', text: 'Bake it' }, PHONE).answer).toEqual({
      option: null,
      text: 'Bake it',
      digest,
      via: 'device',
      callerKind: 'paired-device'
    })
  })

  it('clears an answer: the card waits again and nothing is queued', () => {
    const { store, deps, digest } = setup()
    saveAnswer(deps, { id: 'in_0000000000000001', option: 0, digest })
    expect(saveAnswer(deps, { id: 'in_0000000000000001', text: '', digest })).toMatchObject({
      status: 'open',
      answer: null
    })
    expect(store.queue.forInboxItem('in_0000000000000001')).toEqual([])
  })
})

const QUESTION = { type: 'question', title: 'Which?', options: ['A', 'B'] }
const PUSH = {
  type: 'action',
  title: 'Push?',
  action: 'push',
  actionArgs: { argv: ['/wt', 'b', 'a', 'o'] }
}
const START = {
  type: 'action',
  title: 'Start?',
  action: 'start_run',
  actionArgs: {},
  options: ['Approve — go', 'Skip — no']
}

describe('who may answer (caller kind x card)', () => {
  it('says where to approve and where to answer', () => {
    expect(APPROVE_ON_DESKTOP).toBe('Approve actions in Pilot on this Mac')
    expect(LOCAL_CLI_NO_ANSWER).toBe('Answer cards in Pilot (Inbox)')
  })

  it.each<[string, string | null, Record<string, unknown>, string, string | null]>([
    ['desktop approves an action', 'desktop', PUSH, 'approve', null],
    ['desktop approves an ask-first card', 'desktop', START, 'Approve', null],
    ['desktop skips', 'desktop', PUSH, 'skip', null],
    ['desktop answers a question', 'desktop', QUESTION, 'A', null],
    ['local-cli approves an action', 'local-cli', PUSH, 'approve', LOCAL_CLI_NO_ANSWER],
    ['local-cli skips an action', 'local-cli', PUSH, 'skip', LOCAL_CLI_NO_ANSWER],
    ['local-cli revises an action', 'local-cli', PUSH, 'revise: only the fix', LOCAL_CLI_NO_ANSWER],
    ['local-cli answers a question', 'local-cli', QUESTION, 'A', LOCAL_CLI_NO_ANSWER],
    ['local-cli clears an answer', 'local-cli', QUESTION, '', LOCAL_CLI_NO_ANSWER],
    ['paired device approves an action', 'paired-device', PUSH, 'approve', APPROVE_ON_DESKTOP],
    ['paired device approves with "do it"', 'paired-device', PUSH, 'Do it', APPROVE_ON_DESKTOP],
    [
      'paired device approves an ask-first card',
      'paired-device',
      START,
      'approve',
      APPROVE_ON_DESKTOP
    ],
    ['paired device skips an action', 'paired-device', PUSH, 'skip', null],
    ['paired device revises an action', 'paired-device', PUSH, 'revise: only the fix', null],
    ['paired device skips an ask-first card', 'paired-device', START, 'skip', null],
    ['paired device answers a question', 'paired-device', QUESTION, 'B', null],
    ['no caller identity answers a question', null, QUESTION, 'A', NO_ANSWER_CALLER],
    ['no caller identity approves an action', null, PUSH, 'approve', NO_ANSWER_CALLER],
    ['no caller identity clears an answer', null, QUESTION, '', NO_ANSWER_CALLER]
  ])('%s', (_name, callerKind, card, text, refused) => {
    const { store, deps, digest } = setup(card)
    const origin = { callerKind: callerKind as AnswerOrigin['callerKind'], catalog }
    const run = () => saveAnswer(deps, { id: 'in_0000000000000001', text, digest }, origin)
    if (refused) {
      expect(run).toThrow(refused)
      expect(store.inbox.get('in_0000000000000001')).toMatchObject({ status: 'open', answer: null })
      expect(store.queue.forInboxItem('in_0000000000000001')).toEqual([])
      return
    }
    expect(run().answer).toMatchObject({ text, callerKind })
  })

  it('derives how it was given from the caller, not from params', () => {
    const { deps, digest } = setup(QUESTION)
    const given = { id: 'in_0000000000000001', text: 'A', digest, via: 'page' } as never
    expect(saveAnswer(deps, given, PHONE).answer?.via).toBe('device')
  })

  it('a typed word beats a stale option', () => {
    const { deps, digest } = setup(START)
    expect(() => saveAnswer(deps, { id: 'in_0000000000000001', option: 0, digest }, PHONE)).toThrow(
      APPROVE_ON_DESKTOP
    )
    expect(
      saveAnswer(deps, { id: 'in_0000000000000001', option: 0, text: 'skip', digest }, PHONE).answer
    ).toMatchObject({ option: null, text: 'skip' })
  })

  it("keeps the option when the typed text is exactly that option's label, so a custom first option starts the run", () => {
    const custom = { ...START, options: ['Review', 'Skip'] }
    const give = (text: string) => {
      const { store, deps, digest } = setup(custom)
      saveAnswer(deps, { id: 'in_0000000000000001', option: 0, text, digest })
      const item = store.inbox.get('in_0000000000000001')!
      return [item.answer?.option, routeOf(item, catalog).kind]
    }
    expect(give('Review')).toEqual([0, 'script'])
    expect(give(' review ')).toEqual([0, 'script'])
    expect(give('skip')).toEqual([null, 'tick'])
    expect(give('something')).toEqual([null, 'reask'])
  })

  it('a re-answer from a device replaces a desktop approval, which stops routing to a script', () => {
    const { store, deps, digest } = setup(PUSH)
    saveAnswer(deps, { id: 'in_0000000000000001', text: 'approve', digest })
    saveAnswer(deps, { id: 'in_0000000000000001', text: 'revise: only the fix', digest }, PHONE)
    const item = store.inbox.get('in_0000000000000001')!
    expect(item.answer).toMatchObject({ text: 'revise: only the fix', callerKind: 'paired-device' })
    expect(routeOf(item, catalog)).toEqual({ kind: 'agent', revise: true })
    expect(store.queue.forInboxItem('in_0000000000000001')).toHaveLength(1)
  })

  it('a card changed after the answer cannot be approved on the stale digest', () => {
    const { deps, digest } = setup(PUSH)
    expect(() =>
      saveAnswer(deps, { id: 'in_0000000000000001', text: 'approve', digest: 'a'.repeat(64) })
    ).toThrow(CARD_CHANGED_ON_SAVE)
    expect(
      saveAnswer(deps, { id: 'in_0000000000000001', text: 'approve', digest }).answer?.digest
    ).toBe(digest)
  })
})

describe('a drafted change', () => {
  it('says where a drafted change is approved', () => {
    expect(DRAFT_ON_DESKTOP).toBe(
      'A drafted change applies only on an approval saved in Pilot on this Mac, where its diff shows; approve it there.'
    )
  })

  it.each<[string, Record<string, unknown>, string]>([
    ['a bug', { type: 'bug', title: 'Guard the null?' }, DRAFT_ON_DESKTOP],
    ['a question', QUESTION, DRAFT_OPTION_ON_DESKTOP]
  ])(
    'refuses a device approve on %s and saves nothing; the desktop approve is saved',
    (_name, card, reask) => {
      const { store, deps, digest } = setup(card)
      const ref = {
        path: '/v/Automations/03/b/details/r/F2.json',
        sha256: 'ab'.repeat(32),
        inlined: {},
        blocks: 2,
        drafted: true,
        draftedBase: 'c'.repeat(40)
      }
      store.inbox.edit('in_0000000000000001', { details: ref, digest }, 1_000)
      markReady(store, 'in_0000000000000001') // R-P5: a drafted change is approved on a prepared, ready card
      const params = { id: 'in_0000000000000001', text: 'approve', digest }
      expect(() => saveAnswer(deps, params, PHONE)).toThrow(reask)
      expect(store.inbox.get('in_0000000000000001')).toMatchObject({ status: 'open', answer: null })
      expect(store.queue.forInboxItem('in_0000000000000001')).toEqual([])
      expect(saveAnswer(deps, params, DESKTOP).answer).toMatchObject({ text: 'approve' })
    }
  )
})

describe('an answer that may be being carried out', () => {
  const ID = 'in_0000000000000001'
  const answered = () => {
    const s = setup()
    saveAnswer(s.deps, { id: ID, option: 0, digest: s.digest })
    const row = s.store.queue.forInboxItem(ID)[0]
    return { ...s, row }
  }
  const attempts = (s: ReturnType<typeof answered>) => [
    () => saveAnswer(s.deps, { id: ID, digest: s.digest }),
    () => saveAnswer(s.deps, { id: ID, option: 1, digest: s.digest })
  ]

  it.each([
    ['a ready row (past its settle time)', 'ready'],
    ['a dispatched row whose run is still live', 'live']
  ])('refuses both Undo and a new answer for %s', (_n, kind) => {
    const s = answered()
    if (kind === 'ready') {
      s.advance(SETTLE_MS)
      s.store.queue.update(s.row.id, { state: 'ready' }, 1_000 + SETTLE_MS)
    } else {
      s.store.runs.create({
        id: 'ans-1',
        automationId: 'ci',
        tickId: null,
        itemKey: 'mr:1',
        itemLabel: '!1',
        worktreePath: '/wt',
        startedAt: 5,
        status: 'running',
        trigger: 'answer'
      })
      s.store.queue.update(
        s.row.id,
        { state: 'dispatched', dispatchedRunId: 'ans-1' },
        1_000 + SETTLE_MS
      )
    }
    for (const attempt of attempts(s)) {
      expect(attempt).toThrow(ANSWER_LOCKED)
    }
    expect(s.store.inbox.get(ID)).toMatchObject({ status: 'answered', answer: { option: 0 } })
    expect(s.store.queue.forInboxItem(ID)).toHaveLength(1)
  })

  it.each([
    ['a not_ready row before its settle time', {}],
    ['a held row', { state: 'held' as const, holdReason: 'typing' as const }]
  ])('still allows Undo and a re-answer for %s', (_n, patch) => {
    const s = answered()
    if (Object.keys(patch).length > 0) {
      s.store.queue.update(s.row.id, patch, 1_100)
    }
    s.advance(10_000)
    expect(saveAnswer(s.deps, { id: ID, option: 1, digest: s.digest })).toMatchObject({
      answer: { option: 1 }
    })
    expect(saveAnswer(s.deps, { id: ID, digest: s.digest })).toMatchObject({ status: 'open' })
    expect(s.store.queue.forInboxItem(ID)).toHaveLength(0)
  })
})

describe('answers while context is preparing', () => {
  const card = {
    type: 'bug',
    title: 'Proposed fix',
    preparation: {
      key: 'bug:1',
      context: 'Investigate pinned failure',
      requirements: ['context', 'diff']
    }
  }
  it('atomically cancels preparation for an early freeform answer and refuses a late worker', () => {
    const { deps, store, digest } = setup(card)
    const id = 'in_0000000000000001'
    store.inboxPreparations.claim(id, 1, 'worker', 0, 1000)
    const result = saveAnswer(deps, { id, digest, text: 'I already fixed this elsewhere' })
    expect(result).toMatchObject({ status: 'answered', preparation: { state: 'cancelled' } })
    expect(() =>
      store.inboxPreparations.progress(
        id,
        { runId: 'worker', stepIdx: 0, revision: 1, attempt: 1 },
        'Finishing',
        1001
      )
    ).toThrow('stale')
  })
  it('requeues preparation when an early answer is undone without reviving the old claim', () => {
    const { deps, store, digest } = setup(card)
    const id = 'in_0000000000000001'
    store.inboxPreparations.claim(id, 1, 'worker', 0, 1000)
    saveAnswer(deps, { id, digest, text: 'I already fixed this elsewhere' })
    const reopened = saveAnswer(deps, { id, digest, text: '' })
    expect(reopened.preparation).toMatchObject({ state: 'queued', revision: 2 })
    expect(store.inboxPreparations.listEligible(1001).map((item) => item.id)).toContain(id)
    expect(() =>
      store.inboxPreparations.progress(
        id,
        { runId: 'worker', stepIdx: 0, revision: 1, attempt: 1 },
        'Late progress',
        1001
      )
    ).toThrow('stale')
  })
  // D1: preparation is opt-in. A card added without a request is plain and takes Approve at once, as before.
  it.each(['Approve', 'yes', 'ok', 'do it'])('a plain card takes %s at once', (text) => {
    const { deps, store, digest } = setup({ type: 'bug', title: 'Proposed fix' })
    const id = 'in_0000000000000001'
    expect(store.inbox.get(id)?.preparation ?? null).toBeNull()
    expect(saveAnswer(deps, { id, digest, text })).toMatchObject({ status: 'answered' })
  })
  it.each(['Approve', 'yes', 'ok', 'do it'])('refuses %s before the evidence exists', (text) => {
    const { deps, store, digest } = setup(card)
    expect(() => saveAnswer(deps, { id: 'in_0000000000000001', digest, text })).toThrow(
      'Context is still being prepared'
    )
    expect(store.inbox.get('in_0000000000000001')?.status).toBe('open')
  })
})
