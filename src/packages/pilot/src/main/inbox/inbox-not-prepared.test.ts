import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { InboxAddParams } from '../../shared/inbox-types'
import { parsePeopleYaml } from '../../shared/people'
import { PREPARATION_REFUSED } from '../../shared/preparation'
import { routeOf } from '../answers/queue-view'
import { PilotStore } from '../store/store'
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

function setup() {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-np-')), 'db.sqlite'))
  store.runs.create({
    id: 'run-1',
    automationId: 'ci',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1',
    worktreePath: '/wt',
    startedAt: 1
  })
  let n = 0
  const deps: InboxDeps = {
    store,
    now: () => 100,
    definitions: () => [def.ok ? def.definition : (null as never)],
    people: () => (people.ok ? people.directory : (null as never)),
    newId: () => `in_${String(++n).padStart(16, '0')}`,
    actionNeedsEvidence: (name) => name === 'push' || name === 'post_review'
  }
  return { store, deps }
}

const PUSH: InboxAddParams = {
  runId: 'run-1',
  type: 'action',
  title: 'Push !1?',
  options: ['Approve — push', 'Skip — keep'],
  action: 'push',
  actionArgs: { argv: ['/wt', 'web-1', 'a'.repeat(40), 'b'.repeat(40)] }
}
const PREPARATION = {
  key: 'ci:web-1:push',
  context: 'Pinned push',
  requirements: ['context' as const]
}
const NOT_PREPARED: InboxAddParams = {
  runId: 'run-1',
  type: 'flagged',
  title: 'Push !1?',
  context: 'What the push card asked',
  notPrepared: { key: PREPARATION.key, reason: 'Context is over 64 KB' }
}

// Critical fix: an action that runs on Approve without a person (push, post_review) is only ever offered prepared.
describe('an evidence-needing action from a run', () => {
  it.each(['push', 'post_review'])('is refused without a preparation request: %s', (action) => {
    const { deps, store } = setup()
    expect(() => addInboxItem(deps, { ...PUSH, action })).toThrow(
      `${action} needs prepared evidence`
    )
    expect(store.inbox.list()).toEqual([])
  })

  it('is taken with one, and outside a run (an imported card) as before', () => {
    const { deps } = setup()
    expect(addInboxItem(deps, { ...PUSH, preparation: PREPARATION })).toMatchObject({
      existing: false
    })
    const { runId: _run, ...card } = PUSH
    expect(addInboxItem(deps, { ...card, automationId: 'ci', itemKey: 'mr:1' })).toMatchObject({
      existing: false
    })
  })
})

describe('a refused preparation request', () => {
  it('is refused with a reason the bridge can tell apart', () => {
    const { deps } = setup()
    const bad = { ...PREPARATION, requirements: [] as never[] }
    expect(() => addInboxItem(deps, { ...PUSH, preparation: bad })).toThrow(
      new RegExp(`^${PREPARATION_REFUSED}: `)
    )
  })

  it('posts a flagged card that carries Pilot\'s own "Not prepared" reply and runs nothing', () => {
    const { deps, store } = setup()
    const id = addInboxItem(deps, NOT_PREPARED).id!
    const card = store.inbox.get(id)!
    expect(card).toMatchObject({
      type: 'flagged',
      action: null,
      notPreparedKey: PREPARATION.key,
      replies: [{ text: 'Not prepared: Context is over 64 KB', by: 'pilot' }]
    })
    for (const text of ['Approve', 'push it', 'ok']) {
      store.inbox.update(
        id,
        { answer: { option: null, text, digest: card.digest, via: 'page' } },
        101
      )
      expect(routeOf(store.inbox.get(id)!, { get: () => ({}) })).toEqual({
        kind: 'tick',
        outcome: 'skipped'
      })
    }
  })

  it.each<[string, Partial<InboxAddParams>]>([
    ['an action', { action: 'push', actionArgs: PUSH.actionArgs, type: 'action' }],
    ['parts', { parts: { F1: 'A' } }],
    ['a preparation request', { preparation: PREPARATION }],
    ['a type other than flagged', { type: 'question' }]
  ])('never carries %s', (_name, extra) => {
    const { deps } = setup()
    expect(() => addInboxItem(deps, { ...NOT_PREPARED, ...extra })).toThrow('A "Not prepared" card')
  })

  it('gives way to the prepared card when it arrives, in the same write', () => {
    const { deps, store } = setup()
    const fallback = addInboxItem(deps, NOT_PREPARED).id!
    const other = addInboxItem(deps, {
      ...NOT_PREPARED,
      title: 'Another',
      notPrepared: { key: 'other', reason: 'x' }
    }).id!
    const prepared = addInboxItem(deps, { ...PUSH, preparation: PREPARATION }).id!
    expect(store.inbox.get(fallback)).toMatchObject({
      status: 'obsolete',
      outcome: `superseded: prepared as ${prepared}`
    })
    expect(store.inbox.get(other)?.status).toBe('open')
    expect(store.inbox.get(prepared)?.preparation?.state).toBe('queued')
  })
})
