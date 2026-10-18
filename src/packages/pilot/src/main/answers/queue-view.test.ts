import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { InboxAddParams } from '../../shared/inbox-types'
import { parsePeopleYaml } from '../../shared/people'
import { addReady } from '../inbox/__fixtures__/prepared'
import type { InboxDeps } from '../inbox/inbox-service'
import { PilotStore } from '../store/store'
import {
  APPROVE_ON_DESKTOP,
  DRAFT_ON_DESKTOP,
  DRAFT_OPTION_ON_DESKTOP,
  queueEntries,
  routeOf
} from './queue-view'
import { saveAnswer } from './save'

const def = parseAutomationYaml(
  'name: Fix CI\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: nish\n',
  '/a/ci.yaml'
)
const people = parsePeopleYaml(
  'people:\n  - { id: nish, name: Nish }\n  - { id: emil, name: Emil }\n'
)
if (!def.ok || !people.ok) {
  throw new Error('setup')
}
const catalog = { get: (name: string) => (name === 'push' ? {} : null) }

// runId null: a job-wide card, added outside any run.
function queued(card: Omit<InboxAddParams, 'runId'>, text: string, runId: string | null) {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-queue-')), 'db.sqlite'))
  store.runs.create({
    id: 'run-1',
    automationId: 'ci',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1',
    worktreePath: '/wt',
    startedAt: 1
  })
  const deps: InboxDeps = {
    store,
    now: () => 1_000,
    definitions: () => [def.ok ? def.definition : (null as never)],
    people: () => (people.ok ? people.directory : (null as never)),
    newId: () => 'in_0000000000000001'
  }
  const extra = runId ? { runId } : { automationId: 'ci', itemKey: 'repo:r' }
  addReady(deps, { ...card, ...extra })
  saveAnswer(
    deps,
    { id: 'in_0000000000000001', text, digest: store.inbox.get('in_0000000000000001')!.digest },
    { callerKind: 'desktop', catalog }
  )
  return { deps, store }
}

const PUSH = {
  type: 'action' as const,
  title: 'Push?',
  options: ['Approve — push', 'Skip — keep'],
  action: 'push',
  actionArgs: { argv: ['/wt', 'b', 'a', 'o'] }
}
const QUESTION = { type: 'question' as const, title: 'Which?', options: ['A', 'B'] }
const BUG = { type: 'bug' as const, title: 'Guard the null?' }

describe('queueEntries', () => {
  it.each([
    ['Skip on an action', PUSH, 'skip', 'run-1', 'tick', 'Mark it skipped'],
    ['Approve on a push', PUSH, 'approve', 'run-1', 'script', 'Run push; no agent'],
    [
      'a revision',
      PUSH,
      'revise: push only the fix',
      'run-1',
      'revise',
      'Its agent revises the card and asks again'
    ],
    [
      'a question asked by a run',
      QUESTION,
      'A',
      'run-1',
      'agent',
      'Send your answer to the session that asked'
    ],
    [
      'a job-wide question',
      QUESTION,
      'A',
      null,
      'agent',
      'Start a new answers session with your answer'
    ]
  ])('%s', (_name, card, text, runId, how, fires) => {
    const { deps } = queued(card, text, runId)
    expect(queueEntries(deps, catalog, {})).toMatchObject([
      { itemId: 'in_0000000000000001', automationName: 'Fix CI', state: 'not_ready', how, fires }
    ])
  })

  it("shows only the viewer's answers", () => {
    const { deps } = queued(QUESTION, 'A', 'run-1')
    expect(queueEntries(deps, catalog, { person: 'emil' })).toEqual([])
    expect(queueEntries(deps, catalog, { person: 'nish' })).toHaveLength(1)
  })
})

describe('an answer never routes to a script for a caller other than the desktop', () => {
  // Rows written as an older build, a hand edit or another path might: the route is bound to the caller.
  function stored(
    callerKind: 'desktop' | 'paired-device' | 'local-cli' | undefined,
    text = 'approve'
  ) {
    const { deps, store } = queued(PUSH, 'skip', 'run-1')
    const item = store.inbox.get('in_0000000000000001')!
    const answer = {
      option: null,
      text,
      digest: item.digest,
      via: 'cli' as const,
      ...(callerKind ? { callerKind } : {})
    }
    store.inbox.update(item.id, { answer }, 2_000)
    return { deps, store, item: store.inbox.get(item.id)! }
  }

  it.each<['desktop' | 'paired-device' | 'local-cli' | undefined, object]>([
    ['desktop', { kind: 'script' }],
    ['paired-device', { kind: 'reask', reason: APPROVE_ON_DESKTOP }],
    ['local-cli', { kind: 'reask', reason: APPROVE_ON_DESKTOP }],
    [undefined, { kind: 'reask', reason: APPROVE_ON_DESKTOP }]
  ])('caller %s', (callerKind, expected) => {
    const { item } = stored(callerKind)
    expect(routeOf(item, catalog)).toEqual(expected)
  })

  it('shows no script for an unknown caller or a device', () => {
    for (const kind of [undefined, 'paired-device' as const]) {
      const { deps } = stored(kind)
      expect(queueEntries(deps, catalog, {})).toMatchObject([
        { how: 'reask', fires: APPROVE_ON_DESKTOP }
      ])
    }
  })

  it('a device answer saved while the action was unknown does not become a script when the catalog learns it', () => {
    const { deps } = queued(PUSH, 'skip', 'run-1')
    deps.store.inbox.update(
      'in_0000000000000001',
      {
        answer: {
          option: null,
          text: 'approve',
          digest: 'x',
          via: 'device',
          callerKind: 'paired-device'
        }
      },
      2_000
    )
    const unknown = { get: () => null }
    expect(queueEntries(deps, unknown, {})).toMatchObject([{ how: 'agent' }])
    expect(queueEntries(deps, catalog, {})).toMatchObject([
      { how: 'reask', fires: APPROVE_ON_DESKTOP }
    ])
  })
})

describe('a drafted change is approved only on the desktop', () => {
  const REF = {
    path: '/v/Automations/03/b/details/r/F2.json',
    sha256: 'ab'.repeat(32),
    inlined: {},
    blocks: 2,
    drafted: true,
    draftedBase: 'c'.repeat(40)
  }

  function answered(
    text: string,
    callerKind: 'desktop' | 'paired-device' | undefined,
    drafted = true,
    card: Omit<InboxAddParams, 'runId'> = BUG
  ) {
    const { store } = queued(card, 'A', 'run-1')
    const answer = {
      option: null,
      text,
      digest: 'x',
      via: 'cli' as const,
      ...(callerKind ? { callerKind } : {})
    }
    const id = 'in_0000000000000001'
    store.inbox.edit(
      id,
      { details: { ...REF, drafted }, digest: store.inbox.get(id)!.digest },
      2_000
    )
    store.inbox.update(id, { answer }, 2_000)
    return store.inbox.get(id)!
  }

  it.each<[string, string, 'desktop' | 'paired-device' | undefined, boolean, object]>([
    [
      'an imported approve',
      'approve',
      undefined,
      true,
      { kind: 'reask', reason: DRAFT_ON_DESKTOP }
    ],
    [
      'a device approve',
      'Approve.',
      'paired-device',
      true,
      { kind: 'reask', reason: DRAFT_ON_DESKTOP }
    ],
    ["a device won't fix", "won't fix", 'paired-device', true, { kind: 'agent', revise: false }],
    ['a desktop approve', 'approve', 'desktop', true, { kind: 'agent', revise: false }],
    [
      'a device approve, nothing drafted',
      'approve',
      'paired-device',
      false,
      { kind: 'agent', revise: false }
    ]
  ])('%s', (_name, text, callerKind, drafted, expected) => {
    expect(routeOf(answered(text, callerKind, drafted), catalog)).toEqual(expected)
  })

  // A question's drafted change is approved by picking its option, so the re-ask says that, not "approve".
  it('re-asks a device approve on a question by its drafted option', () => {
    expect(routeOf(answered('approve', 'paired-device', true, QUESTION), catalog)).toEqual({
      kind: 'reask',
      reason: DRAFT_OPTION_ON_DESKTOP
    })
    expect(DRAFT_OPTION_ON_DESKTOP).toBe(
      "A drafted change applies only on a pick saved in Pilot on this Mac, where its diff shows; pick the drafted option in Pilot's window."
    )
  })

  // On a question the draft implements one option (its bundle's Drafted row): picking it asks for the patch.
  it.each<[string, number, 'desktop' | 'paired-device', object]>([
    [
      'a device pick of the drafted option',
      1,
      'paired-device',
      { kind: 'reask', reason: DRAFT_OPTION_ON_DESKTOP }
    ],
    ['a device pick of the other option', 0, 'paired-device', { kind: 'agent', revise: false }],
    ['a desktop pick of the drafted option', 1, 'desktop', { kind: 'agent', revise: false }]
  ])('%s', (_name, option, callerKind, expected) => {
    const { store } = queued(QUESTION, 'A', 'run-1')
    const id = 'in_0000000000000001'
    const details = { ...REF, draftedOption: 'b' }
    store.inbox.edit(id, { details, digest: store.inbox.get(id)!.digest }, 2_000)
    const answer = {
      option,
      text: ['A', 'B'][option],
      digest: 'x',
      via: 'page' as const,
      callerKind
    }
    store.inbox.update(id, { answer }, 2_000)
    expect(routeOf(store.inbox.get(id)!, catalog)).toEqual(expected)
  })
})
