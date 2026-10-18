import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { InboxAddParams } from '../../shared/inbox-types'
import { parsePeopleYaml } from '../../shared/people'
import { PilotStore } from '../store/store'
import { detailsFixture, rewriteBundle } from './__fixtures__/details-fixture'
import { cardOf, inboxDigest } from './card'
import { loadDetails } from './details-bundle'
import { addInboxItem, CHANGED_AFTER_ANSWER } from './inbox-add'
import { ANSWER_LOCKED } from './answer-lock'
import type { InboxDeps } from './inbox-service'

const def = parseAutomationYaml(
  'name: Fix CI\nrepo: web-platform\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: nish\n',
  '/a/ci.yaml'
)
const people = parsePeopleYaml('people:\n  - { id: nish, name: Nish, gitlab: nish8 }\n')
if (!def.ok || !people.ok) {
  throw new Error('setup')
}

function plain(card: InboxAddParams): InboxAddParams {
  const { detailsBundlePath: _bundle, ...rest } = card
  return rest
}

// The card's answer, sent to an answer run that is still running.
function answerRunning(s: { store: PilotStore }, id: string): void {
  const digest = s.store.inbox.get(id)?.digest ?? ''
  s.store.inbox.saveAnswer(id, { option: 0, text: null, digest, via: 'page' }, 'nish', 110)
  s.store.runs.create({
    id: 'ans-1',
    automationId: 'ci',
    tickId: null,
    itemKey: 'mr:1561',
    itemLabel: '!1561',
    worktreePath: null,
    startedAt: 115,
    trigger: 'answer'
  })
  const row = s.store.queue.enqueue(id, 200, 110)
  s.store.queue.update(row, { state: 'dispatched', readyAt: 120, dispatchedRunId: 'ans-1' }, 120)
}

function setup() {
  const f = detailsFixture()
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-inbox-')), 'db.sqlite'))
  let n = 0
  const deps: InboxDeps = {
    store,
    now: () => 100,
    definitions: () => [def.ok ? def.definition : (null as never)],
    people: () => (people.ok ? people.directory : (null as never)),
    newId: () => `in_${String(++n).padStart(16, '0')}`,
    detailsRoot: f.root
  }
  const card: InboxAddParams = {
    automationId: 'ci',
    itemKey: 'mr:1561',
    type: 'bug',
    title: 'Leaving an untouched workspace asks to discard edits',
    detailsBundlePath: f.bundle
  }
  return { f, store, deps, card }
}

describe('addInboxItem with a Details bundle', () => {
  it('keeps the ref on the card and the snapshot beside it; the same bundle again is the same card', () => {
    const { f, store, deps, card } = setup()
    const added = addInboxItem(deps, card)
    const row = store.inbox.get(added.id ?? '')
    expect(row).toMatchObject({ detailsMd: null, version: 1 })
    expect(row?.details?.path).toBe(realpathSync(f.bundle))
    expect(store.inbox.snapshot(row?.id ?? '')).toEqual(loadDetails(f.root, f.bundle))
    expect(addInboxItem(deps, card)).toEqual({ id: added.id, existing: true, refused: null })
    expect(store.inbox.get(added.id ?? '')).toMatchObject({ version: 1, digest: row?.digest })
  })

  it('clears an answer given to the old bundle and replaces the snapshot', () => {
    const { f, store, deps, card } = setup()
    const id = addInboxItem(deps, card).id ?? ''
    const digest = store.inbox.get(id)?.digest ?? ''
    store.inbox.saveAnswer(id, { option: 0, text: null, digest, via: 'page' }, 'nish', 110)
    store.queue.enqueue(id, 200, 110)
    rewriteBundle(f.bundle, (b) => b.blocks.push({ type: 'text', title: 'More', body: 'b' }))
    expect(addInboxItem(deps, card)).toEqual({ id, existing: true, refused: null })
    const row = store.inbox.get(id)
    expect(row).toMatchObject({ version: 2, status: 'open', answer: null, answeredAt: null })
    expect(row?.replies.at(-1)).toEqual({ text: CHANGED_AFTER_ANSWER, by: 'pilot' })
    expect(store.inbox.snapshot(id)?.ref.blocks).toBe(9)
    expect(store.inbox.snapshot(id)?.ref).toEqual(row?.details)
    expect(store.queue.forInboxItem(id)).toEqual([])
  })

  it.each<[string, (s: ReturnType<typeof setup>) => InboxAddParams]>([
    [
      'a new bundle',
      (s) => {
        rewriteBundle(s.f.bundle, (b) => b.blocks.push({ type: 'text', title: 'More', body: 'b' }))
        return s.card
      }
    ],
    ['a change without a bundle', (s) => ({ ...plain(s.card), context: 'Changed' })]
  ])('refuses %s on a card whose answer run is still running', (_name, change) => {
    const s = setup()
    const id = addInboxItem(s.deps, s.card).id ?? ''
    answerRunning(s, id)
    const params = change(s)
    const before = s.store.inbox.get(id)
    const snapshot = s.store.inbox.snapshot(id)
    expect(addInboxItem(s.deps, params)).toEqual({
      id: null,
      existing: true,
      refused: ANSWER_LOCKED
    })
    expect(s.store.inbox.get(id)).toEqual(before)
    expect(s.store.inbox.snapshot(id)).toEqual(snapshot)
  })

  it('refuses a re-add of a card whose answer row is ready past its settle time', () => {
    const s = setup()
    const id = addInboxItem(s.deps, s.card).id ?? ''
    const digest = s.store.inbox.get(id)?.digest ?? ''
    s.store.inbox.saveAnswer(id, { option: 0, text: null, digest, via: 'page' }, 'nish', 50)
    const row = s.store.queue.enqueue(id, 100, 50)
    s.store.queue.update(row, { state: 'ready' }, 100)
    const before = s.store.inbox.get(id)
    expect(addInboxItem(s.deps, { ...plain(s.card), context: 'Changed' })).toEqual({
      id: null,
      existing: true,
      refused: ANSWER_LOCKED
    })
    expect(s.store.inbox.get(id)).toEqual(before)
  })

  it('keeps the bundle when the card is added again without one', () => {
    const { store, deps, card } = setup()
    const id = addInboxItem(deps, card).id ?? ''
    const row = store.inbox.get(id)
    const snapshot = store.inbox.snapshot(id)
    expect(addInboxItem(deps, plain(card))).toEqual({ id, existing: true, refused: null })
    expect(store.inbox.get(id)).toMatchObject({ version: 1, digest: row?.digest })
    addInboxItem(deps, { ...plain(card), context: 'Changed', detailsMd: '## Why' })
    expect(store.inbox.get(id)).toMatchObject({
      version: 2,
      context: 'Changed',
      details: row?.details,
      detailsMd: null
    })
    expect(store.inbox.snapshot(id)).toEqual(snapshot)
  })

  it('refuses markdown Details and a bundle together', () => {
    const { store, deps, card } = setup()
    expect(() => addInboxItem(deps, { ...card, detailsMd: '## Why' })).toThrow(
      'Give Details as markdown (--details-file) or as a bundle (--details-bundle), not both'
    )
    expect(store.inbox.list()).toEqual([])
  })

  it.each([false, true])('writes nothing for a refused bundle (dry run %s)', (dryRun) => {
    const { f, store, deps, card } = setup()
    writeFileSync(f.bundle, '{"version": 2}')
    expect(() => addInboxItem(deps, card, { dryRun })).toThrow(/^Details bundle refused: /)
    expect(store.inbox.list()).toEqual([])
  })
})

// D1 never weakens a prepared card: a re-add without --preparation-file (a producer's plain add, or the bridge's
// plain fallback) is the same card, kept as it is, with its preparation, manifest, snapshot and digest.
describe('a prepared card re-added as a plain one', () => {
  it.each(['queued', 'ready'] as const)('stays the %s prepared card, bundle or not', (state) => {
    const { f, store, deps, card } = setup()
    const preparation = { key: 'k', context: 'Pinned context', requirements: ['context' as const] }
    const id = addInboxItem(deps, { ...plain(card), preparation }).id ?? ''
    if (state === 'ready') {
      const snapshot = loadDetails(f.root, f.bundle, { prepared: true })
      const row = store.inbox.get(id)!
      const digest = inboxDigest({ ...cardOf(row), details: snapshot.ref, detailsMd: null })
      store.inbox.edit(id, { details: snapshot.ref, detailsMd: null, digest }, 100)
      store.inbox.setSnapshot(id, snapshot)
      store.inboxPreparations.write(id, { ...row.preparation!, state: 'ready', updatedAt: 100 })
    }
    const before = store.inbox.get(id)
    const snapshot = store.inbox.snapshot(id)
    for (const again of [card, plain(card)]) {
      expect(addInboxItem(deps, again)).toEqual({ id, existing: true, refused: null })
    }
    expect(store.inbox.get(id)).toEqual(before)
    expect(store.inbox.get(id)?.preparation?.state).toBe(state)
    expect(store.inbox.snapshot(id)).toEqual(snapshot)
    expect(store.inbox.list()).toHaveLength(1)
  })
})
