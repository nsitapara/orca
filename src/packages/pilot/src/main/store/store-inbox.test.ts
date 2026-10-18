import { describe, expect, it } from 'vitest'
import type { InboxAnswer, InboxStatus } from '../../shared/api-types'
import type { DetailsRef, DetailsSnapshot } from '../../shared/details'
import { PilotStore } from './store'
import type { InboxFilter, NewInboxItem } from './store-inbox'

const item = (id: string, extra: Partial<NewInboxItem> = {}): NewInboxItem => ({
  id,
  automationId: 'fix-failed-ci',
  runId: 'run-1',
  stepIdx: 0,
  itemKey: 'mr:1561',
  worktreePath: '/wt/1493',
  person: 'nish',
  type: 'question',
  title: 'Push the fix?',
  context: 'The branch had local commits',
  options: [
    { label: 'Push', meaning: 'push it now' },
    { label: 'Skip', meaning: 'leave it' }
  ],
  suggested: 'Push',
  detailsMd: null,
  action: null,
  actionArgs: null,
  digest: 'd1',
  createdAt: 100,
  source: 'engine',
  vaultRef: null,
  ...extra
})
const answer = (digest: string): InboxAnswer => ({ option: 0, text: null, digest, via: 'page' })
const DETAILS: DetailsRef = {
  path: '/v/Automations/job/b/details/r/F2.json',
  sha256: 'a'.repeat(64),
  inlined: {},
  blocks: 1,
  drafted: false,
  draftedBase: null
}
const SNAPSHOT: DetailsSnapshot = {
  ref: DETAILS,
  bundle: { version: 1, item: 'F2', blocks: [{ type: 'text', title: 'Notes', body: 'b' }] },
  texts: {}
}

describe('InboxStore', () => {
  it('adds an item that is open at version 1, and reads it back', () => {
    const store = PilotStore.open(':memory:')
    const added = item('i1', { action: 'push', actionArgs: { iid: 1561, head: 'abc123' } })
    store.inbox.add(added)
    expect(store.inbox.get('i1')).toEqual({
      ...added,
      version: 1,
      status: 'open',
      answer: null,
      answeredAt: null,
      answeredBy: null,
      updatedAt: 100,
      outcome: null,
      replies: [],
      details: null
    })
    expect(store.inbox.get('missing')).toBeNull()
    expect(store.inbox.snapshot('i1')).toBeNull()
  })

  it("keeps a card's Details ref on the row and its snapshot apart, read only by id", () => {
    const store = PilotStore.open(':memory:')
    store.inbox.add(item('i1', { details: DETAILS }), SNAPSHOT)
    expect(store.inbox.get('i1')?.details).toEqual(DETAILS)
    expect(store.inbox.snapshot('i1')).toEqual(SNAPSHOT)
    expect(Object.keys(store.inbox.list()[0])).not.toContain('snapshot')
    expect(JSON.stringify(store.inbox.list())).not.toContain('Notes')
    store.inbox.setSnapshot('i1', null)
    expect(store.inbox.snapshot('i1')).toBeNull()
  })

  it("clears a card's Details ref as a new version", () => {
    const store = PilotStore.open(':memory:')
    store.inbox.add(item('i1', { details: DETAILS }), SNAPSHOT)
    expect(store.inbox.edit('i1', { details: null, digest: 'd2' }, 150)).toMatchObject({
      details: null,
      digest: 'd2',
      version: 2
    })
  })

  it('keeps the outcome and replies a card is added with', () => {
    const store = PilotStore.open(':memory:')
    store.inbox.add(
      item('i1', {
        outcome: 'Pushed',
        replies: [{ text: 'Done at 10:00', by: 'pilot' }]
      })
    )
    expect(store.inbox.get('i1')).toMatchObject({
      outcome: 'Pushed',
      replies: [{ text: 'Done at 10:00', by: 'pilot' }]
    })
  })

  // Replies written before authors were stored, and anything that isn't a Pilot-authored reply, read back
  // as the agent's: only Pilot's own write paths mark a reply as Pilot's.
  it("reads replies stored without an author, or with one it does not know, as the agent's", () => {
    const store = PilotStore.open(':memory:')
    store.inbox.add(item('i1'))
    // Written as raw JSON, the way an older Pilot stored plain strings.
    const raw = ['legacy', { text: 'x', by: 'admin' }, { text: 'p', by: 'pilot' }, 7]
    store.inbox.update('i1', { replies: raw as never }, 2)
    expect(store.inbox.get('i1')?.replies).toEqual([
      { text: 'legacy', by: 'agent' },
      { text: 'x', by: 'agent' },
      { text: 'p', by: 'pilot' },
      { text: '7', by: 'agent' }
    ])
  })

  const listCases: [string, InboxFilter, string[]][] = [
    ["nish's open items", { status: ['open'] as InboxStatus[], person: 'nish' }, ['i1', 'i3']],
    ['one run', { runId: 'run-2' }, ['i2']],
    ['one worktree, any status', { worktreePath: '/wt/1493' }, ['i1', 'i2']],
    ['one item key', { itemKey: 'mr:9' }, ['i3']],
    ['one automation', { automationId: 'fix-failed-ci' }, ['i1', 'i2', 'i3']],
    ['imported items', { source: 'import' }, ['i3']],
    ['items touched at or after 250', { updatedSince: 250 }, ['i2', 'i3']],
    ['everything', {}, ['i1', 'i2', 'i3']]
  ]
  it.each(listCases)('lists %s, oldest first', (_label, filter, ids) => {
    const store = PilotStore.open(':memory:')
    store.inbox.add(
      item('i3', { itemKey: 'mr:9', worktreePath: '/wt/9', createdAt: 300, source: 'import' })
    )
    store.inbox.add(item('i1'))
    store.inbox.add(item('i2', { runId: 'run-2', createdAt: 200 }))
    store.inbox.setStatus('i2', 'done', 250)
    expect(store.inbox.list(filter).map((i) => i.id)).toEqual(ids)
  })

  it('edits a card into a new version with a new digest, changing only what it is given', () => {
    const store = PilotStore.open(':memory:')
    store.inbox.add(item('i1'))
    const edited = store.inbox.edit(
      'i1',
      {
        title: 'Push the fix now?',
        options: [{ label: 'Push', meaning: 'push it' }],
        digest: 'd2'
      },
      150
    )
    expect(edited).toMatchObject({
      title: 'Push the fix now?',
      options: [{ label: 'Push', meaning: 'push it' }],
      context: 'The branch had local commits',
      digest: 'd2',
      version: 2,
      updatedAt: 150
    })
    expect(store.inbox.edit('missing', { digest: 'x' }, 1)).toBeNull()
  })

  it.each([
    ['the digest the card has', 'd1', 'saved', 'answered'],
    ['a digest the card moved past', 'old', 'changed', 'open']
  ] as const)('saves an answer given against %s: %s', (_label, digest, result, status) => {
    const store = PilotStore.open(':memory:')
    store.inbox.add(item('i1'))
    expect(store.inbox.saveAnswer('i1', answer(digest), 'nish', 120)).toBe(result)
    expect(store.inbox.get('i1')?.status).toBe(status)
  })

  it('keeps who answered, when, and the digest the answer was given against', () => {
    const store = PilotStore.open(':memory:')
    store.inbox.add(item('i1'))
    store.inbox.saveAnswer(
      'i1',
      { option: null, text: 'Rebase first', digest: 'd1', via: 'cli' },
      'nish',
      120
    )
    expect(store.inbox.get('i1')).toMatchObject({
      status: 'answered',
      answer: { option: null, text: 'Rebase first', digest: 'd1', via: 'cli' },
      answeredAt: 120,
      answeredBy: 'nish',
      updatedAt: 120
    })
  })

  it('refuses an answer on a closed card or a missing one', () => {
    const store = PilotStore.open(':memory:')
    store.inbox.add(item('i1'))
    store.inbox.setStatus('i1', 'obsolete', 110)
    expect(store.inbox.saveAnswer('i1', answer('d1'), 'nish', 120)).toBe('closed')
    expect(store.inbox.saveAnswer('nope', answer('d1'), 'nish', 120)).toBe('missing')
    expect(store.inbox.get('i1')?.status).toBe('obsolete')
  })

  it('updates a card without making a new version', () => {
    const store = PilotStore.open(':memory:')
    store.inbox.add(item('i1'))
    store.inbox.update(
      'i1',
      {
        status: 'done',
        outcome: 'Pushed',
        replies: [{ text: 'ok', by: 'agent' }],
        person: 'sam',
        worktreePath: null
      },
      160
    )
    expect(store.inbox.get('i1')).toMatchObject({
      status: 'done',
      outcome: 'Pushed',
      replies: [{ text: 'ok', by: 'agent' }],
      person: 'sam',
      worktreePath: null,
      version: 1,
      digest: 'd1',
      updatedAt: 160
    })
  })

  it("counts a run's open cards without the defaults its agent took", () => {
    const store = PilotStore.open(':memory:')
    store.inbox.add(item('q1', { runId: 'r1' }))
    store.inbox.add(item('d1', { runId: 'r1', type: 'default' }))
    store.inbox.add(item('d2', { runId: 'r2', type: 'default' }))
    expect(store.inbox.openCountForRun('r1')).toBe(1)
    expect(store.inbox.openCountForRun('r2')).toBe(0)
    store.close()
  })

  it('counts the open items a run left', () => {
    const store = PilotStore.open(':memory:')
    store.inbox.add(item('i1'))
    store.inbox.add(item('i2'))
    store.inbox.add(item('i3', { runId: 'run-2' }))
    store.inbox.setStatus('i2', 'dismissed', 5)
    expect(store.inbox.openCountForRun('run-1')).toBe(1)
    expect(store.inbox.openCountForRun('run-9')).toBe(0)
  })
})

describe('fillSummaries', () => {
  it('skips a row it cannot read and still fills the others', () => {
    const store = PilotStore.open(':memory:')
    const good: DetailsSnapshot = {
      ref: DETAILS,
      bundle: { version: 1, item: 'x', blocks: [{ type: 'shots', shots: [{ file: 'a.png' }] }] },
      texts: {}
    }
    store.inbox.add(item('bad', { details: DETAILS }), {
      ref: DETAILS,
      bundle: null,
      texts: {}
    } as never)
    store.inbox.add(item('good', { details: DETAILS }), good)
    expect(() => store.inbox.fillSummaries()).not.toThrow()
    expect(store.inbox.get('bad')?.details?.summary).toBeUndefined()
    expect(store.inbox.get('good')?.details?.summary).toEqual(['1 screenshot'])
  })
})
