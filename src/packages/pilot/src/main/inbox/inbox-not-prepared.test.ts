import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { InboxAddParams } from '../../shared/inbox-types'
import { parsePeopleYaml } from '../../shared/people'
import { PREPARATION_REFUSED } from '../../shared/preparation'
import { routeFor, routeOf } from '../answers/queue-view'
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
    newId: () => `in_${String(++n).padStart(16, '0')}`
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

  // R-P5: whoever adds it and however bound.
  it('is taken with one, and refused outside a run without one', () => {
    const { deps } = setup()
    expect(addInboxItem(deps, { ...PUSH, preparation: PREPARATION })).toMatchObject({
      existing: false
    })
    const { runId: _run, ...card } = PUSH
    const named = { ...card, automationId: 'ci', itemKey: 'mr:2' }
    expect(() => addInboxItem(deps, named)).toThrow('push needs prepared evidence')
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
    ['a type other than flagged', { type: 'question' }],
    ['a Details bundle', { detailsBundlePath: '/v/Automations/b.json' }]
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

// Security review of the fallback: who may retire a notice, which notice, and what an answer on one can do.
describe('retiring a "Not prepared" notice', () => {
  function withRun(store: PilotStore, id: string, itemKey: string) {
    store.runs.create({
      id,
      automationId: 'ci',
      tickId: null,
      itemKey,
      itemLabel: itemKey,
      worktreePath: `/wt/${itemKey}`,
      startedAt: 1
    })
  }

  it("never retires another item's notice that claims the same key", () => {
    const { deps, store } = setup()
    withRun(store, 'run-2', 'mr:2')
    const theirs = addInboxItem(deps, { ...NOT_PREPARED, runId: 'run-2' }).id!
    addInboxItem(deps, { ...PUSH, preparation: PREPARATION })
    expect(store.inbox.get(theirs)?.status).toBe('open')
  })

  it('never retires an answered notice', () => {
    const { deps, store } = setup()
    const id = addInboxItem(deps, NOT_PREPARED).id!
    const digest = store.inbox.get(id)!.digest
    store.inbox.update(
      id,
      { status: 'answered', answer: { option: null, text: 'ok', digest, via: 'page' } },
      101
    )
    addInboxItem(deps, { ...PUSH, preparation: PREPARATION })
    expect(store.inbox.get(id)?.status).toBe('answered')
  })

  it('is only done by a run: a prepared add from outside one leaves the notice', () => {
    const { deps, store } = setup()
    const id = addInboxItem(deps, NOT_PREPARED).id!
    // The automation's last real tick showed the item's worktree, so an add from outside a run may name it.
    const tickId = store.startTick('ci', 1)
    const decision = {
      key: 'mr:1',
      label: '!1',
      verdict: 'started' as const,
      reason: '',
      checks: [],
      onceKey: '1',
      fields: { 'worktree.path': '/wt' }
    }
    store.recordDecisions(tickId, [decision], new Map([['mr:1', 'run-1']]))
    const { runId: _run, ...card } = PUSH
    addInboxItem(deps, {
      ...card,
      automationId: 'ci',
      itemKey: 'mr:1',
      worktreePath: '/wt',
      preparation: PREPARATION
    })
    expect(store.inbox.get(id)?.status).toBe('open')
  })

  it('runs nothing on an Approve or a pick from the desktop', () => {
    const { deps, store } = setup()
    const card = store.inbox.get(addInboxItem(deps, NOT_PREPARED).id!)!
    const catalog = { get: () => ({}) }
    for (const answer of [
      { text: 'Approve', option: null },
      { text: 'Install', option: 0 }
    ]) {
      expect(routeFor(card, catalog, { ...answer, callerKind: 'desktop' })).toEqual({
        kind: 'tick',
        outcome: 'skipped'
      })
    }
  })
})

// A notice and a plain card never merge, whatever their titles: the notice's key is part of the card's identity.
describe('a "Not prepared" notice and a plain flagged card of the same title', () => {
  const PLAIN = { runId: 'run-1', type: 'flagged' as const, title: 'Push !1?', context: 'A flag' }
  it.each([
    ['a plain card after the notice', [NOT_PREPARED, PLAIN]],
    ['a notice after the plain card', [PLAIN, NOT_PREPARED]]
  ] as const)('stay two cards: %s', (_name, [first, second]) => {
    const { deps, store } = setup()
    const a = addInboxItem(deps, first).id!
    const b = addInboxItem(deps, second)
    expect(b).toMatchObject({ existing: false })
    expect(b.id).not.toBe(a)
    expect(
      store.inbox
        .list()
        .map((card) => card.notPreparedKey ?? null)
        .sort()
    ).toEqual([PREPARATION.key, null])
  })
})
