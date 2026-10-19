import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { linearError } from '../../../../../main/linear/issue-context-errors'
import type { InboxAnswer, InboxItemRow, InboxStatus } from '../../shared/api-types'
import type { LinearErrorCode } from '../../../../../shared/linear/agent-access'
import { formatTicketedOutcome, FROZEN_DRAFT } from '../../shared/ticket-outcome'
import type { TicketDraft, TicketDraftEdit } from '../../shared/ticket-types'
import { callerStore, DEFINITIONS } from '../actions/__fixtures__/caller-store'
import { buildActionCatalog } from '../actions/catalog'
import { writeIdFor } from '../actions/linear-entries'
import { markReadyEntry } from '../actions/mark-ready'
import { pushBranchEntry } from '../actions/push-branch'
import type { LinearWriter } from '../linear-connector/linear-writer'
import type { NewInboxItem } from '../store/store-inbox'
import type { PilotStore } from '../store/store'
import { detailsFixture, type DetailsFixture } from './__fixtures__/details-fixture'
import { skillsWithTemplate } from './__fixtures__/follow-up-ticket'
import { loadDetails } from './details-bundle'
import { buildInboxDeps } from './inbox-service'
import { buildTicketDraft } from './ticket-draft'
import { fileTicketForLater, type TicketForLaterDeps } from './ticket-for-later'

const MR = 'https://gitlab.com/g/p/-/merge_requests/9'
const DIGEST = 'd'.repeat(64)
const ISSUE = {
  identifier: 'WEB-1482',
  url: 'https://linear.app/x/issue/WEB-1482',
  branchName: null
}
const WRITE_ID = writeIdFor('ticket-for-later\0in_1')
const BASE_EDIT: TicketDraftEdit = {
  title: 'Mixed greys in the sidebar',
  body: 'Seen on load.',
  team: 'WEB',
  state: 'Backlog',
  priority: 'low',
  labels: [],
  images: []
}

function writer() {
  let uploads = 0
  return {
    teamWorkspace: vi.fn<LinearWriter['teamWorkspace']>(async () => 'ws-web'),
    uploadImage: vi.fn<LinearWriter['uploadImage']>(async () => ({
      assetUrl: `https://uploads.linear.app/a/${++uploads}`
    })),
    createIssue: vi.fn<LinearWriter['createIssue']>(async () => ISSUE),
    addComment: vi.fn<LinearWriter['addComment']>(async () => ({ url: null })),
    setState: vi.fn<LinearWriter['setState']>(async () => {}),
    attachUrl: vi.fn<LinearWriter['attachUrl']>(async () => {})
  }
}

const card = (extra: Partial<NewInboxItem> = {}): NewInboxItem => ({
  id: 'in_1',
  automationId: 'ui-qa-overnight',
  runId: 'run_1',
  stepIdx: 1,
  itemKey: 'wt:7',
  worktreePath: '/wt/7',
  person: 'nish',
  type: 'left_for_you',
  title: 'F2 Mixed colors — a.tsx:1',
  context: 'The sidebar mixes two greys.',
  options: [],
  suggested: 'Use one token.',
  detailsMd: null,
  action: null,
  actionArgs: null,
  digest: DIGEST,
  createdAt: 1,
  source: 'engine',
  vaultRef: null,
  ...extra
})

// The card in_1 on a finished run of job 04, with F2's Details (three screenshots), a real catalog over a fake Linear.
function seeded(over: { card?: Partial<NewInboxItem>; prepared?: boolean } = {}) {
  const fixture = callerStore()
  const { store } = fixture
  const f: DetailsFixture = detailsFixture()
  const linear = writer()
  fixture.run('run_1', 'ui-qa-overnight', 'wt:7', '/wt/7', {
    'worktree.branch': 'feat/x',
    'mr.web_url': MR,
    'mr.title': 'Fix the sidebar'
  })
  store.runs.update('run_1', { status: 'done', outcome: 'Done', finishedAt: 50 })
  store.inbox.add(card(over.card), loadDetails(f.root, f.bundle, { prepared: over.prepared }))
  const pilotcli = vi.fn()
  const binary = () => '/bin/pilotcli'
  const cards = { branchOf: () => null, worktreeOn: () => null, openOn: () => null }
  const catalog = buildActionCatalog({
    push: pushBranchEntry({ pilotcli, binary }),
    markReady: markReadyEntry({ pilotcli, binary, folder: () => null, cards }),
    linear,
    linearFiles: { detailsRoot: f.root }
  })
  const inbox = buildInboxDeps({
    store,
    now: () => 2000,
    definitions: () => DEFINITIONS,
    people: fixture.inbox.people,
    actions: catalog,
    onResolved: null,
    detailsRoot: f.root
  })
  const skills = skillsWithTemplate()
  const deps: TicketForLaterDeps = {
    store,
    definitions: () => DEFINITIONS,
    detailsRoot: f.root,
    skillDirs: () => [skills.dir],
    attempt: { store, now: () => 2000, catalog, definitions: () => DEFINITIONS, inbox },
    inbox
  }
  return { store, f, linear, deps }
}

// What the person sends after editing the draft: every field changed, every screenshot ticked.
function edited(draft: TicketDraft, over: Partial<TicketDraftEdit> = {}): TicketDraftEdit {
  return {
    title: 'Mixed greys in the sidebar',
    body: `${draft.body}\nSeen twice.`,
    team: 'WEB',
    state: 'Todo',
    priority: 'high',
    labels: ['qa'],
    images: draft.images.map((image) => image.ref),
    ...over
  }
}

const ticketCards = (store: PilotStore): InboxItemRow[] =>
  store.inbox.list({}).filter((item) => item.id !== 'in_1')

describe('fileTicketForLater', () => {
  it('files the reviewed draft through a Pilot-asked linear_create card, and closes both cards', async () => {
    const { store, linear, deps } = seeded()
    const run = store.runs.get('run_1')
    const draft = buildTicketDraft(deps, 'in_1', DIGEST)
    const edit = edited(draft)

    const result = await fileTicketForLater(deps, { id: 'in_1', digest: DIGEST, draft: edit })

    expect(result).toEqual({ ok: true, identifier: 'WEB-1482', url: ISSUE.url })
    expect(store.inbox.get('in_1')).toMatchObject({
      status: 'done',
      outcome: formatTicketedOutcome({ identifier: 'WEB-1482', url: ISSUE.url })
    })
    expect(ticketCards(store)).toEqual([
      expect.objectContaining({
        type: 'action',
        action: 'linear_create',
        runId: null,
        automationId: 'ui-qa-overnight',
        itemKey: 'wt:7',
        status: 'done',
        title: 'Create a WEB ticket: Mixed greys in the sidebar?',
        context: 'Ticket for later from card in_1.',
        options: [
          { label: 'Approve', meaning: 'create it' },
          { label: 'Skip', meaning: 'leave it' }
        ],
        outcome: `done: created WEB-1482 · ${ISSUE.url}`
      })
    ])
    expect(linear.createIssue.mock.calls).toEqual([
      [
        {
          team: 'WEB',
          title: 'Mixed greys in the sidebar',
          body: edit.body.replace(/pilot-image:(\d+)/g, 'https://uploads.linear.app/a/$1'),
          state: 'Todo',
          assignee: 'me',
          priority: 'high',
          labels: ['qa'],
          workspaceId: undefined,
          writeId: WRITE_ID
        }
      ]
    ])
    expect(linear.attachUrl).toHaveBeenCalledWith(
      'WEB-1482',
      MR,
      'Fix the sidebar',
      expect.objectContaining({ workspaceId: 'ws-web' })
    )
    expect(store.runs.get('run_1')).toEqual(run)
  })

  const ANSWER: InboxAnswer = { option: null, text: 'Fixed it', digest: DIGEST, via: 'page' }
  it.each<{
    name: string
    meanwhile: (store: PilotStore) => void
    status: InboxStatus
    answer: InboxAnswer | null
  }>([
    {
      name: 'answered',
      meanwhile: (store) => store.inbox.saveAnswer('in_1', ANSWER, 'nish', 5),
      status: 'answered',
      answer: ANSWER
    },
    {
      name: 're-filed as a new version',
      meanwhile: (store) =>
        store.inbox.edit('in_1', { context: 'Again.', digest: 'e'.repeat(64) }, 5),
      status: 'open',
      answer: null
    }
  ])(
    'leaves a card $name while Create ran as it is, and only names the ticket under it',
    async ({ meanwhile, status, answer }) => {
      const { store, linear, deps } = seeded()
      linear.createIssue.mockImplementation(async () => {
        meanwhile(store)
        return ISSUE
      })
      const edit = edited(buildTicketDraft(deps, 'in_1', DIGEST))

      const result = await fileTicketForLater(deps, { id: 'in_1', digest: DIGEST, draft: edit })

      expect(result).toEqual({ ok: true, identifier: 'WEB-1482', url: ISSUE.url })
      const card = store.inbox.get('in_1')
      expect(card).toMatchObject({ status, answer, outcome: null })
      expect(card?.replies.at(-1)).toEqual({
        text: `Ticketed for later as WEB-1482 · ${ISSUE.url}`,
        by: 'pilot'
      })
    }
  )

  it.each<{
    name: string
    edit: (draft: TicketDraft) => Partial<TicketDraftEdit>
    dropped: string
    uploads: string[]
  }>([
    {
      name: 'an unticked screenshot',
      edit: () => ({ images: ['pilot-image:1', 'pilot-image:3'] }),
      dropped: '![Leaving an untouched PGT-M workspace (after)](pilot-image:2)',
      uploads: ['F2-before.png', 'F2-qa.png']
    },
    {
      name: 'a ref the person typed, with no screenshot',
      edit: (draft) => ({ body: `${draft.body}\nAlso ![typed](pilot-image:9) here` }),
      dropped: 'Also ![typed](pilot-image:9) here',
      uploads: ['F2-before.png', 'F2-after.png', 'F2-qa.png']
    }
  ])('drops the body line of $name, and uploads only the screenshots kept', async (row) => {
    const { store, linear, deps } = seeded()
    const draft = buildTicketDraft(deps, 'in_1', DIGEST)
    const edit = edited(draft, row.edit(draft))

    expect(await fileTicketForLater(deps, { id: 'in_1', digest: DIGEST, draft: edit })).toEqual({
      ok: true,
      identifier: 'WEB-1482',
      url: ISSUE.url
    })

    const filed = ticketCards(store)[0]?.actionArgs
    expect(filed?.body).toBe(
      edit.body
        .split('\n')
        .filter((line) => line !== row.dropped)
        .join('\n')
    )
    expect(linear.uploadImage.mock.calls.map(([input]) => input.filename)).toEqual(row.uploads)
    expect(linear.createIssue.mock.calls[0]?.[0].body).not.toContain('pilot-image:')
  })

  it.each<{ code: LinearErrorCode; maybeCreated: boolean; outcome: string }>([
    { code: 'linear_write_unconfirmed', maybeCreated: true, outcome: 'may have created' },
    { code: 'linear_invalid_label', maybeCreated: false, outcome: 'not created' }
  ])(
    'a create failing with $code closes only the ticket card as $outcome, and freezes the draft only when it may have created',
    async ({ code, maybeCreated, outcome }) => {
      const { store, linear, deps } = seeded()
      linear.createIssue.mockRejectedValue(linearError(code, 'Linear said no'))
      const edit = edited(buildTicketDraft(deps, 'in_1', DIGEST))

      const result = await fileTicketForLater(deps, { id: 'in_1', digest: DIGEST, draft: edit })

      expect(result).toEqual({ ok: false, error: 'Linear said no', maybeCreated })
      expect(ticketCards(store)).toEqual([
        expect.objectContaining({
          status: 'obsolete',
          outcome: `obsolete: ${outcome}: Linear said no`
        })
      ])
      expect(store.inbox.get('in_1')?.status).toBe('open')
      expect(buildTicketDraft(deps, 'in_1', DIGEST).frozen).toEqual(maybeCreated ? edit : undefined)
    }
  )

  it.each<{
    name: string
    again: (deps: TicketForLaterDeps, sent: TicketDraftEdit) => TicketDraftEdit
  }>([
    { name: "the panel's own frozen request", again: (_deps, sent) => sent },
    {
      name: 'the frozen draft a reopened panel gets',
      again: (deps) => buildTicketDraft(deps, 'in_1', DIGEST).frozen ?? BASE_EDIT
    }
  ])(
    'retries $name with a fresh ticket card under the same write id, so Linear can make only one ticket',
    async ({ again }) => {
      const { store, linear, deps } = seeded()
      linear.createIssue.mockRejectedValueOnce(
        linearError('linear_write_unconfirmed', 'Linear said no')
      )
      const req = {
        id: 'in_1',
        digest: DIGEST,
        draft: edited(buildTicketDraft(deps, 'in_1', DIGEST), { images: ['pilot-image:1'] })
      }

      expect(await fileTicketForLater(deps, req)).toMatchObject({ ok: false, maybeCreated: true })
      expect(await fileTicketForLater(deps, { ...req, draft: again(deps, req.draft) })).toEqual({
        ok: true,
        identifier: 'WEB-1482',
        url: ISSUE.url
      })

      expect(linear.createIssue.mock.calls.map(([input]) => input.writeId)).toEqual([
        WRITE_ID,
        WRITE_ID
      ])
      const [first, second] = ticketCards(store).map((item) => item.actionArgs)
      expect(second).toEqual(first)
      expect(
        ticketCards(store)
          .map((item) => item.status)
          .toSorted()
      ).toEqual(['done', 'obsolete'])
      expect(store.inbox.get('in_1')?.status).toBe('done')
    }
  )

  it.each<{ name: string; change: Partial<TicketDraftEdit> }>([
    { name: 'title', change: { title: 'Another title' } },
    { name: 'body', change: { body: 'Another body.' } },
    { name: 'screenshots', change: { images: ['pilot-image:1', 'pilot-image:3'] } },
    { name: 'team', change: { team: 'OPS' } },
    { name: 'state', change: { state: 'Backlog' } },
    { name: 'priority', change: { priority: 'low' } },
    { name: 'labels', change: { labels: ['ui'] } }
  ])(
    'refuses a Create with an edited $name while Linear may hold the first ticket, and files nothing',
    async ({ change }) => {
      const { store, linear, deps } = seeded()
      linear.createIssue.mockRejectedValueOnce(
        linearError('linear_write_unconfirmed', 'Linear said no')
      )
      const draft = buildTicketDraft(deps, 'in_1', DIGEST)
      await fileTicketForLater(deps, { id: 'in_1', digest: DIGEST, draft: edited(draft) })

      const result = await fileTicketForLater(deps, {
        id: 'in_1',
        digest: DIGEST,
        draft: edited(draft, change)
      })

      expect(result).toEqual({ ok: false, error: FROZEN_DRAFT, maybeCreated: true })
      expect(linear.createIssue).toHaveBeenCalledTimes(1)
      expect(linear.uploadImage).toHaveBeenCalledTimes(3)
      expect(ticketCards(store)).toHaveLength(1)
      expect(store.inbox.get('in_1')?.status).toBe('open')
    }
  )

  it('closes the ticket card as may have created, and freezes the draft, when the attempt throws', async () => {
    const { store, deps } = seeded()
    const finish = store.actions.finish.bind(store.actions)
    vi.spyOn(store.actions, 'finish').mockImplementation((id, status, output, at) => {
      if (status === 'done') {
        throw new Error('database is locked')
      }
      finish(id, status, output, at)
    })
    const edit = edited(buildTicketDraft(deps, 'in_1', DIGEST))

    const result = await fileTicketForLater(deps, { id: 'in_1', digest: DIGEST, draft: edit })

    expect(result).toEqual({ ok: false, error: 'database is locked', maybeCreated: true })
    expect(ticketCards(store)).toEqual([
      expect.objectContaining({
        status: 'obsolete',
        outcome: 'obsolete: may have created: database is locked'
      })
    ])
    expect(store.inbox.get('in_1')?.status).toBe('open')
    expect(buildTicketDraft(deps, 'in_1', DIGEST).frozen).toEqual(edit)
  })

  it.each<{
    name: string
    card?: Partial<NewInboxItem>
    status?: InboxStatus
    digest?: string
    body?: string
    error: string
  }>([
    {
      name: 'a digest the card no longer has',
      digest: 'e'.repeat(64),
      error: 'The card changed; reopen the draft'
    },
    { name: 'an answered card', status: 'answered', error: 'This card is already answered' },
    { name: 'a closed card', status: 'obsolete', error: 'This card is already obsolete' },
    {
      name: 'an action card',
      card: { type: 'action', action: 'linear_create' },
      error: "An action card's Approve is its effect"
    },
    {
      name: 'a card with no item key',
      card: { runId: null, itemKey: null },
      error: "This card has no item key, so it can't be filed"
    },
    {
      name: 'args over the 16 KB card cap',
      body: 'x'.repeat(16 * 1024),
      error: 'The description is too long to file; shorten it.'
    }
  ])('refuses $name, and files nothing', async (row) => {
    const { store, linear, deps } = seeded({ card: row.card })
    if (row.status) {
      store.inbox.update('in_1', { status: row.status }, 10)
    }
    const before = store.inbox.get('in_1')

    const result = await fileTicketForLater(deps, {
      id: 'in_1',
      digest: row.digest ?? DIGEST,
      draft: { ...BASE_EDIT, body: row.body ?? BASE_EDIT.body }
    })

    expect(result).toEqual({ ok: false, error: row.error, maybeCreated: false })
    expect(ticketCards(store)).toEqual([])
    expect(store.inbox.get('in_1')).toEqual(before)
    expect(linear.createIssue).not.toHaveBeenCalled()
  })

  it.each<{ name: string; prepared: boolean; change: (f: DetailsFixture) => void; error: string }>([
    {
      name: 'a screenshot deleted since the draft',
      prepared: false,
      change: (f) => rmSync(join(f.dir, 'F2-qa.png')),
      error: `image "F2-qa.png" doesn't exist`
    },
    {
      name: "a prepared card's screenshot changed since its context was prepared",
      prepared: true,
      change: (f) => writeFileSync(join(f.dir, 'F2-qa.png'), 'different bytes'),
      error: 'image "F2-qa.png" changed after context was prepared'
    }
  ])('refuses $name, and uploads and files nothing', async (row) => {
    const { store, f, linear, deps } = seeded({ prepared: row.prepared })
    const draft = buildTicketDraft(deps, 'in_1', DIGEST)
    row.change(f)

    const result = await fileTicketForLater(deps, {
      id: 'in_1',
      digest: DIGEST,
      draft: edited(draft)
    })

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining(row.error),
      maybeCreated: false
    })
    expect(ticketCards(store)).toEqual([])
    expect(linear.uploadImage).not.toHaveBeenCalled()
    expect(store.inbox.get('in_1')?.status).toBe('open')
  })

  it('refuses a second Create while the first is in flight, and makes one ticket', async () => {
    const { store, linear, deps } = seeded()
    let release = () => {}
    let entered = () => {}
    const reached = new Promise<void>((resolve) => {
      entered = resolve
    })
    linear.createIssue.mockImplementation(async () => {
      entered()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return ISSUE
    })
    const req = {
      id: 'in_1',
      digest: DIGEST,
      draft: edited(buildTicketDraft(deps, 'in_1', DIGEST))
    }

    const first = fileTicketForLater(deps, req)
    expect(await fileTicketForLater(deps, req)).toEqual({
      ok: false,
      error: 'This card is already being filed',
      maybeCreated: false
    })
    // A first call that never reaches Linear fails below rather than hanging here.
    await Promise.race([reached, first])
    release()

    expect(await first).toEqual({ ok: true, identifier: 'WEB-1482', url: ISSUE.url })
    expect(linear.createIssue).toHaveBeenCalledTimes(1)
    expect(ticketCards(store)).toHaveLength(1)
  })

  it("closes Pilot's ticket card, and creates nothing, when its ask can't be recorded", async () => {
    const { store, linear, deps } = seeded()
    const draft = buildTicketDraft(deps, 'in_1', DIGEST)
    vi.spyOn(store.actions, 'start').mockImplementationOnce(() => {
      throw new Error('database is locked')
    })

    const result = await fileTicketForLater(deps, {
      id: 'in_1',
      digest: DIGEST,
      draft: edited(draft)
    })

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining('database is locked'),
      maybeCreated: false
    })
    expect(ticketCards(store)).toEqual([
      expect.objectContaining({
        status: 'obsolete',
        outcome: expect.stringMatching(/^obsolete: not created: /)
      })
    ])
    expect(store.inbox.get('in_1')?.status).toBe('open')
    expect(linear.createIssue).not.toHaveBeenCalled()
  })
})
