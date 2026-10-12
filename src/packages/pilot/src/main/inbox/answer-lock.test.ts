import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { parsePeopleYaml } from '../../shared/people'
import { PilotStore } from '../store/store'
import { answerLocked } from './answer-lock'
import { addInboxItem } from './inbox-add'
import type { InboxDeps } from './inbox-service'

const def = parseAutomationYaml(
  'name: Fix CI\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: nish\n',
  '/a/ci.yaml'
)
const people = parsePeopleYaml('people:\n  - { id: nish, name: Nish }\n')
if (!def.ok || !people.ok) {
  throw new Error('setup')
}
const ID = 'in_0000000000000001'

function setup(answered: boolean) {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-lock-')), 'db.sqlite'))
  const deps: InboxDeps = {
    store,
    now: () => 1_000,
    definitions: () => [def.ok ? def.definition : (null as never)],
    people: () => (people.ok ? people.directory : (null as never)),
    newId: () => ID
  }
  addInboxItem(deps, { automationId: 'ci', itemKey: 'mr:1', type: 'bug', title: 'x' })
  if (answered) {
    const digest = store.inbox.get(ID)?.digest ?? ''
    store.inbox.saveAnswer(ID, { option: 0, text: null, digest, via: 'page' }, 'nish', 10)
  }
  const run = (status: 'running' | 'done') =>
    store.runs.create({
      id: 'ans-1',
      automationId: 'ci',
      tickId: null,
      itemKey: 'mr:1',
      itemLabel: '!1',
      worktreePath: null,
      startedAt: 5,
      status,
      trigger: 'answer'
    })
  return { store, run }
}

describe('answerLocked', () => {
  it.each([
    ['not answered', false, null, false],
    ['no row', true, null, false],
    ['a not_ready row before its settle time', true, { state: 'not_ready', readyAt: 2_000 }, false],
    [
      'a not_ready row past its settle time (nothing picked it up)',
      true,
      { state: 'not_ready', readyAt: 1_000 },
      false
    ],
    ['a held row', true, { state: 'held', readyAt: 500 }, false],
    ['a failed row', true, { state: 'failed', readyAt: 500 }, false],
    ['a ready row past its settle time', true, { state: 'ready', readyAt: 1_000 }, true],
    ['a ready row well past it', true, { state: 'ready', readyAt: 10 }, true]
  ] as const)('%s', (_n, answered, row, locked) => {
    const s = setup(answered)
    if (row) {
      const id = s.store.queue.enqueue(ID, row.readyAt, 10)
      s.store.queue.update(id, { state: row.state }, 10)
    }
    expect(answerLocked(s.store, s.store.inbox.get(ID)!, 1_000)).toBe(locked)
  })

  it.each([
    ['running', true],
    ['done', false]
  ] as const)('a dispatched row whose run is %s', (status, locked) => {
    const s = setup(true)
    s.run(status)
    const id = s.store.queue.enqueue(ID, 10, 10)
    s.store.queue.update(id, { state: 'dispatched', dispatchedRunId: 'ans-1' }, 10)
    expect(answerLocked(s.store, s.store.inbox.get(ID)!, 1_000)).toBe(locked)
    expect(answerLocked(s.store, s.store.inbox.get(ID)!, 1_000, 'ans-1')).toBe(false)
  })
})
