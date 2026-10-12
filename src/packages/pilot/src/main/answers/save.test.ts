import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { parsePeopleYaml } from '../../shared/people'
import { addInboxItem } from '../inbox/inbox-add'
import { resolveInboxItem, type InboxDeps } from '../inbox/inbox-service'
import { PilotStore } from '../store/store'
import {
  APPROVE_ON_DESKTOP,
  CARD_CHANGED_ON_SAVE,
  NO_ANSWER_CALLER,
  saveAnswer as save,
  SETTLE_MS,
  type AnswerOrigin
} from './save'

const catalog = { get: (name: string) => (name === 'push' || name === 'start_run' ? {} : null) }
const DESKTOP: AnswerOrigin = { callerKind: 'desktop', catalog }
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
  addInboxItem(deps, { runId: 'run-1', ...card } as never)
  const item = store.inbox.get('in_0000000000000001')!
  return { store, deps, digest: item.digest, advance: (ms: number) => (clock += ms) }
}

describe('saveAnswer', () => {
  it('saves a page answer against the version shown and queues it to settle for 180 s', () => {
    const { store, deps, digest } = setup()
    const saved = saveAnswer(deps, { id: 'in_0000000000000001', option: 1, digest, via: 'page' })
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
    saveAnswer(deps, { id: 'in_0000000000000001', option: 0, digest, via: 'page' })
    advance(60_000)
    saveAnswer(deps, {
      id: 'in_0000000000000001',
      text: 'Bake it, and drop the job step',
      digest,
      via: 'page'
    })
    expect(store.queue.forInboxItem('in_0000000000000001')).toMatchObject([
      { state: 'not_ready', readyAt: 61_000 + SETTLE_MS }
    ])
    expect(store.inbox.get('in_0000000000000001')?.answer?.text).toBe(
      'Bake it, and drop the job step'
    )
  })

  it.each([
    ['a card that changed', { digest: 'f'.repeat(64), via: 'page' as const }, CARD_CHANGED_ON_SAVE],
    [
      'a page save that names no version',
      { via: 'page' as const },
      'A page answer names the card version it answers'
    ],
    ['an option the card lacks', { option: 5 }, "Option 6 isn't on this card"]
  ])('refuses %s', (_name, params, message) => {
    const { deps } = setup()
    expect(() => saveAnswer(deps, { id: 'in_0000000000000001', option: 0, ...params })).toThrow(
      message
    )
  })

  it('refuses an answer on a closed card', () => {
    const { deps } = setup()
    resolveInboxItem(deps, 'in_0000000000000001', 'obsolete: !1 merged')
    expect(() => saveAnswer(deps, { id: 'in_0000000000000001', text: 'x' })).toThrow(
      'This card is obsolete; it takes no answer'
    )
  })

  it('takes a CLI answer as the current version, marked cli', () => {
    const { deps, digest } = setup()
    expect(saveAnswer(deps, { id: 'in_0000000000000001', text: 'Bake it' }).answer).toEqual({
      option: null,
      text: 'Bake it',
      digest,
      via: 'cli',
      callerKind: 'desktop'
    })
  })

  it('clears an answer: the card waits again and nothing is queued', () => {
    const { store, deps, digest } = setup()
    saveAnswer(deps, { id: 'in_0000000000000001', option: 0, digest, via: 'page' })
    expect(
      saveAnswer(deps, { id: 'in_0000000000000001', text: '', digest, via: 'page' })
    ).toMatchObject({ status: 'open', answer: null })
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
const REFUSED = APPROVE_ON_DESKTOP

describe('who may approve (caller kind x card)', () => {
  it('says where to approve', () =>
    expect(APPROVE_ON_DESKTOP).toBe('Approve actions in Pilot on this Mac'))

  it.each<[string, string | null, Record<string, unknown>, string, string | null]>([
    ['desktop approves an action', 'desktop', PUSH, 'approve', null],
    ['desktop approves an ask-first card', 'desktop', START, 'Approve', null],
    ['local-cli approves an action', 'local-cli', PUSH, 'approve', REFUSED],
    ['local-cli approves with the words "do it"', 'local-cli', PUSH, 'Do it', REFUSED],
    ['local-cli approves an ask-first card', 'local-cli', START, 'approve: notes', REFUSED],
    ['local-cli approves part of an action', 'local-cli', PUSH, 'approve', REFUSED],
    ['local-cli skips an action', 'local-cli', PUSH, 'skip', null],
    ['local-cli revises an action', 'local-cli', PUSH, 'revise: push only the fix', null],
    ['local-cli answers a question', 'local-cli', QUESTION, 'A', null],
    ['paired device approves an action', 'paired-device', PUSH, 'approve', REFUSED],
    ['paired device approves an ask-first card', 'paired-device', START, 'approve', REFUSED],
    ['paired device skips an ask-first card', 'paired-device', START, 'skip', null],
    ['paired device answers a question', 'paired-device', QUESTION, 'B', null],
    ['no caller identity answers a question', null, QUESTION, 'A', NO_ANSWER_CALLER],
    ['no caller identity approves an action', null, PUSH, 'approve', NO_ANSWER_CALLER],
    ['no caller identity clears an answer', null, QUESTION, '', NO_ANSWER_CALLER]
  ])('%s', (_name, callerKind, card, text, refused) => {
    const { store, deps } = setup(card)
    const origin = { callerKind: callerKind as AnswerOrigin['callerKind'], catalog }
    const run = () => saveAnswer(deps, { id: 'in_0000000000000001', text }, origin)
    if (refused) {
      expect(run).toThrow(refused)
      expect(store.inbox.get('in_0000000000000001')).toMatchObject({ status: 'open', answer: null })
      expect(store.queue.forInboxItem('in_0000000000000001')).toEqual([])
      return
    }
    expect(run().answer).toMatchObject({ text, callerKind })
  })

  it('an option 0 pick approves, so a typed word beats a stale option', () => {
    const { deps } = setup(START)
    const origin = { callerKind: 'local-cli' as const, catalog }
    expect(() => saveAnswer(deps, { id: 'in_0000000000000001', option: 0 }, origin)).toThrow(
      REFUSED
    )
    expect(
      saveAnswer(deps, { id: 'in_0000000000000001', option: 0, text: 'skip' }, origin).answer
    ).toMatchObject({ option: null, text: 'skip' })
  })

  it('a card that changed after an approval cannot be approved on the stale digest', () => {
    const { deps, digest } = setup(PUSH)
    expect(() =>
      saveAnswer(deps, {
        id: 'in_0000000000000001',
        text: 'approve',
        digest: 'a'.repeat(64),
        via: 'page'
      })
    ).toThrow(CARD_CHANGED_ON_SAVE)
    expect(
      saveAnswer(deps, { id: 'in_0000000000000001', text: 'approve', digest, via: 'page' }).answer
        ?.digest
    ).toBe(digest)
  })
})
