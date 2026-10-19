import { describe, expect, it } from 'vitest'
import { formatTicketedOutcome } from '../../shared/ticket-outcome'
import type { TicketedRef } from '../../shared/ticket-types'
import { parsePeopleYaml } from '../../shared/people'
import { PilotStore } from '../store/store'
import type { NewInboxItem } from '../store/store-inbox'
import { listInbox, type InboxDeps } from './inbox-service'
import { ticketedBeforeFor } from './ticketed-before'

const REF: TicketedRef = { identifier: 'WEB-7', url: 'https://linear.app/x/issue/WEB-7' }
const NEWER: TicketedRef = { identifier: 'WEB-8', url: 'https://linear.app/x/issue/WEB-8' }

const parsed = parsePeopleYaml('people:\n  - { id: nish, name: Nish }\n')
if (!parsed.ok) {
  throw new Error('setup')
}
const directory = parsed.directory

const card = (id: string, extra: Partial<NewInboxItem> = {}): NewInboxItem => ({
  id,
  automationId: 'ui-qa-overnight',
  runId: null,
  stepIdx: 1,
  itemKey: 'wt:7',
  worktreePath: null,
  person: 'nish',
  type: 'left_for_you',
  title: 'F2 Mixed colors — b.tsx:9',
  context: '',
  options: [],
  suggested: null,
  detailsMd: null,
  action: null,
  actionArgs: null,
  digest: id,
  createdAt: 1,
  source: 'engine',
  vaultRef: null,
  ...extra
})

function seeded() {
  const store = PilotStore.open(':memory:')
  const done = (id: string, outcome: string, at: number, extra: Partial<NewInboxItem> = {}) => {
    store.inbox.add(card(id, { title: 'F2 Mixed colors — a.tsx:1', ...extra }))
    store.inbox.update(id, { status: 'done', outcome }, at)
  }
  done('old', formatTicketedOutcome(REF), 10)
  return { store, done }
}

describe('ticketedBeforeFor', () => {
  const cases: {
    name: string
    open: Partial<NewInboxItem>
    expected: TicketedRef | null
  }[] = [
    { name: 'same finding at another location', open: {}, expected: REF },
    { name: 'different title', open: { title: 'F3 Other — b.tsx:9' }, expected: null },
    { name: 'different automation', open: { automationId: 'other' }, expected: null },
    { name: 'different item key', open: { itemKey: 'wt:8' }, expected: null },
    { name: 'no item key', open: { itemKey: null }, expected: null }
  ]
  it.each(cases)('$name', ({ open, expected }) => {
    const { store } = seeded()
    store.inbox.add(card('open', open))
    const found = ticketedBeforeFor(store, [store.inbox.get('open')!])
    expect(found.get('open') ?? null).toEqual(expected)
  })

  it('ignores a done card that was not ticketed for later', () => {
    const store = PilotStore.open(':memory:')
    store.inbox.add(card('d', { title: 'F2 Mixed colors — a.tsx:1' }))
    store.inbox.update('d', { status: 'done', outcome: 'done: created WEB-9' }, 10)
    store.inbox.add(card('open'))
    expect(ticketedBeforeFor(store, [store.inbox.get('open')!]).size).toBe(0)
  })

  it('takes the newest of two matches', () => {
    const { store, done } = seeded()
    done('newer', formatTicketedOutcome(NEWER), 20)
    done('mid', formatTicketedOutcome(REF), 15)
    store.inbox.add(card('open'))
    expect(ticketedBeforeFor(store, [store.inbox.get('open')!]).get('open')).toEqual(NEWER)
  })
})

describe('listInbox ticketedBefore', () => {
  it('is set on the matched row only, and absent elsewhere', () => {
    const { store } = seeded()
    store.inbox.add(card('hit'))
    store.inbox.add(card('miss', { title: 'F3 Other — b.tsx:9' }))
    const deps: InboxDeps = {
      store,
      now: () => 100,
      definitions: () => [],
      people: () => directory
    }
    const rows = listInbox(deps, {}).items
    const hit = rows.find((r) => r.id === 'hit')!
    const miss = rows.find((r) => r.id === 'miss')!
    expect(hit.ticketedBefore).toEqual(REF)
    expect('ticketedBefore' in miss).toBe(false)
  })
})
