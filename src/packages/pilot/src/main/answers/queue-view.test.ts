import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { InboxAddParams } from '../../shared/inbox-types'
import { parsePeopleYaml } from '../../shared/people'
import { addInboxItem } from '../inbox/inbox-add'
import type { InboxDeps } from '../inbox/inbox-service'
import { PilotStore } from '../store/store'
import { queueEntries } from './queue-view'
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
const catalog = { get: (name: string) => (['push', 'post_review'].includes(name) ? {} : null) }

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
  addInboxItem(deps, { ...card, ...extra })
  saveAnswer(deps, { id: 'in_0000000000000001', text }, { callerKind: 'desktop', catalog })
  return { deps, store }
}

const PUSH = {
  type: 'action' as const,
  title: 'Push?',
  options: ['Approve — push', 'Skip — keep'],
  action: 'push',
  actionArgs: { argv: ['/wt', 'b', 'a', 'o'] }
}
const POST = {
  ...PUSH,
  title: 'Post?',
  action: 'post_review',
  actionArgs: { argv: ['1579', 'f.json', 'abc'] },
  parts: { F1: 'Null check', F2: 'Naming' }
}
const QUESTION = { type: 'question' as const, title: 'Which?', options: ['A', 'B'] }

describe('queueEntries', () => {
  it.each([
    ['Skip on an action', PUSH, 'skip', 'run-1', 'tick', 'Mark it skipped'],
    ['Approve on a push', PUSH, 'approve', 'run-1', 'script', 'Run push; no agent'],
    [
      'parts left out',
      POST,
      'approve except: F2',
      'run-1',
      'script',
      'Run post_review without F2; no agent'
    ],
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
