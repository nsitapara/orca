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
import { ANSWER_LOCKED } from './answer-lock'
import { setInboxDetails } from './inbox-details'
import { buildCard, inboxDigest } from './card'
import { listInbox, replyToInboxItem, type InboxDeps } from './inbox-service'
import type { RunStatus } from '../../shared/api-types'

const def = parseAutomationYaml(
  'name: Fix CI\nrepo: web-platform\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: nish\n',
  '/a/ci.yaml'
)
const people = parsePeopleYaml('people:\n  - { id: nish, name: Nish, gitlab: nish8 }\n')
if (!def.ok || !people.ok) {
  throw new Error('setup')
}
const OPEN = { head: null }

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
  // The answer sent to an answer run in this state, or (null) sent before Pilot took over (no run).
  const dispatch = (runStatus: RunStatus | null) => {
    const row = answer()
    if (runStatus) {
      store.runs.create({
        id: 'ans-1',
        automationId: 'ci',
        tickId: null,
        itemKey: 'mr:1561',
        itemLabel: '!1561',
        worktreePath: null,
        startedAt: 115,
        status: runStatus,
        trigger: 'answer'
      })
    }
    const dispatchedRunId = runStatus ? 'ans-1' : null
    store.queue.update(row, { state: 'dispatched', readyAt: 120, dispatchedRunId }, 120)
  }
  return { f, store, deps, id, answer, dispatch }
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
    expect(setInboxDetails(deps, id, f.bundle, { head })).toMatchObject({
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

  // Only an answer run still running is applying the answer: a dispatched row outlives its run.
  it.each<[string, (s: ReturnType<typeof setup>) => void]>([
    ['whose answer run finished', (s) => s.dispatch('done')],
    ['whose answer run failed', (s) => s.dispatch('failed')],
    ['sent before Pilot took over (no answer run)', (s) => s.dispatch(null)],
    [
      'its answer run reopened, then answered again',
      (s) => {
        s.dispatch('done')
        replyToInboxItem(s.deps, s.id, 'Which commit?')
        s.answer()
      }
    ]
  ])('clears the answer of a card %s', (_name, arrange) => {
    const s = setup()
    arrange(s)
    expect(setInboxDetails(s.deps, s.id, s.f.bundle, OPEN)).toMatchObject({
      changed: true,
      cleared: true
    })
    expect(s.store.inbox.get(s.id)).toMatchObject({ status: 'open', answer: null })
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
      'an answered card whose answer run is still running',
      (s) => {
        s.dispatch('running')
        return [s.f.bundle, OPEN]
      },
      ANSWER_LOCKED
    ],
    [
      'an answered card whose row is ready past its settle time (an action may be running)',
      (s) => {
        const row = s.answer()
        s.store.queue.update(row, { state: 'ready', readyAt: 100 }, 100)
        return [s.f.bundle, OPEN]
      },
      ANSWER_LOCKED
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

describe('the Details summary chips', () => {
  it('is derived when the bundle is loaded', () => {
    const f = detailsFixture()
    const { ref } = loadDetails(f.root, f.bundle)
    expect(ref.summary).toEqual(expect.arrayContaining(['drafted fix']))
    expect(ref.summary?.length).toBeLessThanOrEqual(4)
  })

  it('fills a ref stored without it when the list is built, once, leaving the digest and version alone', () => {
    const { f, store, deps, id } = setup()
    setInboxDetails(deps, id, f.bundle, OPEN)
    const before = store.inbox.get(id)
    const { summary, ...old } = before?.details ?? ({} as never)
    store.inbox.edit(id, { details: old as never, digest: before?.digest ?? '' }, 150)
    expect(store.inbox.get(id)?.details?.summary).toBeUndefined()
    const stamp = store.inbox.get(id)
    listInbox(deps, {})
    const filled = store.inbox.get(id)
    expect(filled?.details?.summary).toEqual(summary)
    expect(filled?.digest).toBe(before?.digest)
    expect(filled?.version).toBe(stamp?.version)
    expect(filled?.updatedAt).toBe(stamp?.updatedAt)
    listInbox(deps, {})
    expect(store.inbox.get(id)).toEqual(filled)
  })

  it('takes the subject from the facts block’s MR row, and fills it into a ref stored without it', () => {
    const { f, store, deps, id } = setup()
    rewriteBundle(f.bundle, (b) => {
      b.blocks.unshift({ type: 'facts', rows: [['MR', '!1579 web-2107-improve']] })
    })
    expect(loadDetails(f.root, f.bundle).ref.subject).toBe('!1579 web-2107-improve')
    setInboxDetails(deps, id, f.bundle, OPEN)
    const before = store.inbox.get(id)
    const { subject: _s, ...old } = before?.details ?? ({} as never)
    store.inbox.edit(id, { details: old as never, digest: before?.digest ?? '' }, 150)
    listInbox(deps, {})
    expect(store.inbox.get(id)?.details?.subject).toBe('!1579 web-2107-improve')
    expect(store.inbox.get(id)?.digest).toBe(before?.digest)
  })

  it('is not part of the digest', () => {
    const f = detailsFixture()
    const { ref } = loadDetails(f.root, f.bundle)
    const card = buildCard({ automationId: 'a', type: 'bug', title: 't' } as never, ref)
    const { summary: _s, subject: _j, ...bare } = ref
    expect(inboxDigest(card)).toBe(inboxDigest({ ...card, details: bare }))
    expect(inboxDigest({ ...card, details: { ...ref, subject: '!1 other' } })).toBe(
      inboxDigest(card)
    )
  })
})
