import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { InboxAddParams } from '../../shared/inbox-types'
import { parsePeopleYaml } from '../../shared/people'
import { PilotStore } from '../store/store'
import { detailsFixture, REVIEW_BLOCK, rewriteBundle } from './__fixtures__/details-fixture'
import { loadDetails } from './details-bundle'
import { addInboxItem, CHANGED_AFTER_ANSWER } from './inbox-add'
import { ANSWER_BEING_APPLIED } from './inbox-details'
import type { InboxDeps } from './inbox-service'

const def = parseAutomationYaml(
  'name: Fix CI\nrepo: web-platform\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: nish\n',
  '/a/ci.yaml'
)
const people = parsePeopleYaml('people:\n  - { id: nish, name: Nish, gitlab: nish8 }\n')
if (!def.ok || !people.ok) {
  throw new Error('setup')
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

  it('is a new version when an inlined review file changes, though the bundle bytes do not', () => {
    const { f, store, deps, card } = setup()
    rewriteBundle(f.bundle, (b) => b.blocks.push(REVIEW_BLOCK))
    const id = addInboxItem(deps, card).id ?? ''
    const before = store.inbox.get(id)
    const reviewPath = join(f.dir, 'sample-review.json')
    const review = JSON.parse(readFileSync(reviewPath, 'utf8'))
    review.parts[0].comment = 'Another comment'
    writeFileSync(reviewPath, JSON.stringify(review))
    addInboxItem(deps, card)
    const after = store.inbox.get(id)
    expect(after?.details?.sha256).toBe(before?.details?.sha256)
    expect(after?.digest).not.toBe(before?.digest)
    expect(after?.version).toBe(2)
    expect(store.inbox.snapshot(id)?.texts['sample-review.json']).toContain('Another comment')
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

  it('refuses a new bundle on a card whose answer is being applied, and leaves the card as it was', () => {
    const { f, store, deps, card } = setup()
    const id = addInboxItem(deps, card).id ?? ''
    const digest = store.inbox.get(id)?.digest ?? ''
    store.inbox.saveAnswer(id, { option: 0, text: null, digest, via: 'page' }, 'nish', 110)
    store.queue.update(
      store.queue.enqueue(id, 200, 110),
      { state: 'dispatched', readyAt: 120 },
      120
    )
    rewriteBundle(f.bundle, (b) => b.blocks.push({ type: 'text', title: 'More', body: 'b' }))
    const before = store.inbox.get(id)
    const snapshot = store.inbox.snapshot(id)
    expect(() => addInboxItem(deps, card)).toThrow(ANSWER_BEING_APPLIED)
    expect(store.inbox.get(id)).toEqual(before)
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
