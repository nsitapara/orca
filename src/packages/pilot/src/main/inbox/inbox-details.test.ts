import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { parsePeopleYaml } from '../../shared/people'
import { DETAILS_CHANGED } from '../../shared/pilot-replies'
import { PilotStore } from '../store/store'
import { copyBundle, detailsFixture, rewriteBundle } from './__fixtures__/details-fixture'
import { loadDetails } from './details-bundle'
import { addInboxItem } from './inbox-add'
import { ANSWER_BEING_APPLIED, HAS_DETAILS_SINCE, setInboxDetails } from './inbox-details'
import type { InboxDeps } from './inbox-service'

const def = parseAutomationYaml(
  'name: Fix CI\nrepo: web-platform\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: nish\n',
  '/a/ci.yaml'
)
const people = parsePeopleYaml('people:\n  - { id: nish, name: Nish, gitlab: nish8 }\n')
if (!def.ok || !people.ok) {
  throw new Error('setup')
}
const OPEN = { head: null, onlyUnanswered: false }

function setup() {
  const f = detailsFixture()
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-inbox-')), 'db.sqlite'))
  const deps: InboxDeps = {
    store,
    now: () => 100,
    definitions: () => [def.ok ? def.definition : (null as never)],
    people: () => (people.ok ? people.directory : (null as never)),
    newId: () => 'in_0000000000000001',
    detailsRoot: f.root
  }
  const id =
    addInboxItem(deps, {
      automationId: 'ci',
      itemKey: 'mr:1561',
      type: 'bug',
      title: 'Leaving asks to discard edits',
      detailsMd: '## Why\nThe blocker is unconditional.'
    }).id ?? ''
  const answer = () => {
    const digest = store.inbox.get(id)?.digest ?? ''
    store.inbox.saveAnswer(id, { option: 0, text: null, digest, via: 'page' }, 'nish', 110)
    return store.queue.enqueue(id, 200, 110)
  }
  return { f, store, deps, id, answer }
}

describe('setInboxDetails', () => {
  it("attaches a bundle as the card's next version: markdown goes, the snapshot is the bundle's", () => {
    const { f, store, deps, id } = setup()
    expect(setInboxDetails(deps, id, f.bundle, OPEN)).toEqual({
      id,
      version: 2,
      changed: true,
      cleared: false
    })
    const snapshot = loadDetails(f.root, f.bundle)
    expect(store.inbox.get(id)).toMatchObject({
      version: 2,
      detailsMd: null,
      details: snapshot.ref
    })
    expect(store.inbox.snapshot(id)).toEqual(snapshot)
    expect(store.events.list({ kinds: ['item_updated'] }).at(-1)?.payload).toEqual({
      id,
      version: 2,
      reason: 'details',
      cleared: false
    })
  })

  it('changes nothing for the bundle the card already shows', () => {
    const { f, store, deps, id } = setup()
    setInboxDetails(deps, id, f.bundle, OPEN)
    expect(setInboxDetails(deps, id, f.bundle, OPEN)).toEqual({
      id,
      version: 2,
      changed: false,
      cleared: false
    })
    expect(store.inbox.get(id)?.version).toBe(2)
  })

  it.each([
    [
      '1234abcd99',
      'Re-drafted against 1234abcd: the branch moved, the patch changed, or your notes asked for changes. Approve the version shown now.'
    ],
    [null, DETAILS_CHANGED]
  ])('clears an answer, its queue row, and says why (head %s)', (head, reply) => {
    const { f, store, deps, id, answer } = setup()
    answer()
    expect(setInboxDetails(deps, id, f.bundle, { head, onlyUnanswered: false })).toMatchObject({
      changed: true,
      cleared: true
    })
    expect(store.inbox.get(id)).toMatchObject({
      status: 'open',
      answer: null,
      answeredAt: null,
      answeredBy: null
    })
    expect(store.inbox.get(id)?.replies.at(-1)).toEqual({ text: reply, by: 'pilot' })
    expect(store.queue.forInboxItem(id)).toEqual([])
  })

  it('leaves a bundle attached meanwhile when only a card without one may change', () => {
    const { f, store, deps, id } = setup()
    const drafted = copyBundle(f, 'F3.json')
    rewriteBundle(drafted, (b) => (b.item = 'F3'))
    setInboxDetails(deps, id, drafted, OPEN)
    const before = store.inbox.get(id)
    expect(() =>
      setInboxDetails(deps, id, f.bundle, { ...OPEN, onlyWithoutDetails: true })
    ).toThrow(HAS_DETAILS_SINCE)
    expect(store.inbox.get(id)).toEqual(before)
    expect(store.inbox.snapshot(id)?.bundle.item).toBe('F3')
  })

  it('replaces one bundle with another', () => {
    const { f, store, deps, id } = setup()
    setInboxDetails(deps, id, f.bundle, OPEN)
    const next = copyBundle(f, 'F3.json')
    rewriteBundle(next, (b) => (b.item = 'F3'))
    setInboxDetails(deps, id, next, OPEN)
    expect(store.inbox.snapshot(id)?.bundle.item).toBe('F3')
    expect(store.inbox.get(id)?.version).toBe(3)
  })

  it.each<[string, (s: ReturnType<typeof setup>) => [string, typeof OPEN], RegExp | string]>([
    [
      'a card that is done',
      (s) => {
        s.store.inbox.setStatus(s.id, 'done', 120)
        return [s.f.bundle, OPEN]
      },
      'is already done'
    ],
    [
      'an invalid bundle',
      (s) => {
        writeFileSync(s.f.bundle, '{"version": 2}')
        return [s.f.bundle, OPEN]
      },
      /^Details bundle refused: /
    ],
    [
      'an answered card, when only an unanswered one may change',
      (s) => {
        s.answer()
        return [s.f.bundle, { head: null, onlyUnanswered: true }]
      },
      'answered since; Details not attached'
    ],
    [
      'an answered card whose answer is being applied',
      (s) => {
        s.store.queue.update(s.answer(), { state: 'dispatched', readyAt: 120 }, 120)
        return [s.f.bundle, OPEN]
      },
      ANSWER_BEING_APPLIED
    ]
  ])('refuses %s and leaves the card as it was', (_name, arrange, message) => {
    const s = setup()
    const [bundle, opts] = arrange(s)
    const before = s.store.inbox.get(s.id)
    expect(() => setInboxDetails(s.deps, s.id, bundle, opts)).toThrow(message)
    expect(s.store.inbox.get(s.id)).toEqual(before)
    expect(s.store.inbox.snapshot(s.id)).toBeNull()
  })
})
