// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LINEAR_UPLOAD_PUT_TIMEOUT_MS,
  LINEAR_UPLOAD_SIGN_TIMEOUT_MS
} from '../../../shared/ticket-create-deadline'
import type { TicketCreateResult, TicketDraft, TicketDraftEdit } from '../../../shared/ticket-types'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))
const toastSuccess = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (...args: unknown[]) => toastSuccess(...args) }
}))

import { inboxRow } from '../../hosts/__fixtures__/inbox-row'
import { LOCAL_PILOT_HOST } from '../../hosts/pilot-host'
import { TicketDraftPanel } from './TicketDraftPanel'

const ITEM = {
  ...inboxRow({ id: 'in_9', digest: 'card-digest', type: 'flagged', itemKey: 'wt:7' }),
  host: LOCAL_PILOT_HOST
}
const MR_URL = 'https://gitlab.example.com/web/-/merge_requests/1579'
const DRAFT: TicketDraft = {
  title: 'Save button overlaps the footer',
  body: '## Evidence\n\n![Before](pilot-image:1)\n![After](pilot-image:2)\n',
  team: 'WEB',
  state: 'Backlog',
  priority: 'low',
  labels: ['ui'],
  assignee: 'me',
  images: [
    { ref: 'pilot-image:1', file: 'shots/before.png', caption: 'Before' },
    { ref: 'pilot-image:2', file: 'shots/after.png', caption: 'After' }
  ],
  link: { url: MR_URL, title: '!1579 Fix the footer' },
  ticketedBefore: null,
  templatePath: '/skills/follow-up-ticket/assets/ticket.md',
  digest: 'draft-digest'
}
const FILED = { identifier: 'WEB-1482', url: 'https://linear.app/herasight/issue/WEB-1482' }
const NOTE = 'Ticked screenshots upload to Linear. Untick any that show real patient data.'
const FROZEN =
  "Linear may have created this ticket. Retry sends the same draft and can't make a second one."

type Create = (params: unknown) => Promise<TicketCreateResult>

function serve(create: Create, draft: TicketDraft = DRAFT): void {
  pilotRpc.mockImplementation(async (method: string, params: unknown) => {
    if (method === 'pilot.inbox.ticketDraft') {
      return draft
    }
    if (method === 'pilot.inbox.image') {
      return { mime: 'image/png', base64: 'iVBORw0KGgo=' }
    }
    if (method === 'pilot.inbox.ticketForLater') {
      return create(params)
    }
    throw new Error(`unexpected ${method}`)
  })
}

const creates = () => pilotRpc.mock.calls.filter((c) => c[0] === 'pilot.inbox.ticketForLater')
const input = (name: string) => screen.getByLabelText<HTMLInputElement>(name)
const fields = () => [
  input('Title'),
  input('Team'),
  input('State'),
  input('Labels'),
  screen.getByLabelText<HTMLSelectElement>('Priority'),
  screen.getByLabelText<HTMLTextAreaElement>('Description'),
  ...screen.getAllByRole<HTMLButtonElement>('checkbox')
]

async function open(
  create: Create = async () => ({ ok: true, ...FILED }),
  draft: TicketDraft = DRAFT
) {
  serve(create, draft)
  const onClose = vi.fn()
  const onFiled = vi.fn()
  render(<TicketDraftPanel item={ITEM} onClose={onClose} onFiled={onFiled} />)
  await screen.findByDisplayValue(draft.frozen?.title ?? draft.title)
  return { onClose, onFiled }
}

describe('TicketDraftPanel', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
    toastSuccess.mockReset()
  })

  it('loads the draft for the card shown and lays out every field', async () => {
    await open()
    expect(pilotRpc).toHaveBeenCalledWith('pilot.inbox.ticketDraft', {
      id: 'in_9',
      digest: 'card-digest'
    })
    expect(input('Title').value).toBe(DRAFT.title)
    expect(input('Team').value).toBe('WEB')
    expect(input('State').value).toBe('Backlog')
    expect(screen.getByLabelText<HTMLSelectElement>('Priority').value).toBe('low')
    expect(input('Labels').value).toBe('ui')
    expect(screen.getByLabelText<HTMLTextAreaElement>('Description').value).toBe(DRAFT.body)
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'true'])
    expect(screen.getByText(NOTE)).toBeTruthy()
    expect(screen.getByRole('link', { name: '!1579 Fix the footer' }).getAttribute('href')).toBe(
      MR_URL
    )
  })

  it('sends the edited fields, only the ticked screenshots and the draft digest', async () => {
    let settle: (r: TicketCreateResult) => void = () => {}
    await open(() => new Promise((resolve) => (settle = resolve)))
    fireEvent.change(input('Title'), { target: { value: 'Footer overlaps Save' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /pilot-image:2/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Create WEB ticket' }))
    const pending = await screen.findByRole<HTMLButtonElement>('button', { name: 'Creating…' })
    expect(pending.disabled).toBe(true)
    expect(creates()).toHaveLength(1)
    expect(creates()[0][1]).toEqual({
      id: 'in_9',
      digest: 'draft-digest',
      draft: {
        title: 'Footer overlaps Save',
        body: DRAFT.body,
        team: 'WEB',
        state: 'Backlog',
        priority: 'low',
        labels: ['ui'],
        images: ['pilot-image:1']
      }
    })
    settle({ ok: false, error: 'Team not found', maybeCreated: false })
    await screen.findByText('Team not found')
  })

  it('leaves an unticked screenshot unticked when its thumbnail is clicked; its caption ticks it', async () => {
    await open()
    const box = screen.getByRole('checkbox', { name: /pilot-image:2/ })
    fireEvent.click(box)
    expect(box.getAttribute('aria-checked')).toBe('false')
    await waitFor(() => expect(document.querySelectorAll('img')).toHaveLength(2))
    fireEvent.click(document.querySelectorAll('img')[1])
    expect(box.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByText('After'))
    expect(box.getAttribute('aria-checked')).toBe('true')
  })

  it('keeps "What Create does" in step with the fields', async () => {
    await open()
    expect(
      screen.getByText(
        'Uploads 2 screenshots · creates a WEB ticket in Backlog, low, labelled ui, assigned to you · attaches the MR link · closes this card'
      )
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /pilot-image:1/ }))
    fireEvent.change(input('Team'), { target: { value: 'OPS' } })
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } })
    expect(
      screen.getByText(
        'Uploads 1 screenshot · creates a OPS ticket in Backlog, high, labelled ui, assigned to you · attaches the MR link · closes this card'
      )
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create OPS ticket' })).toBeTruthy()
  })

  it.each([
    ['a blank title', 'Title', '   '],
    ['a title over 255 characters', 'Title', 'x'.repeat(256)],
    ['no team', 'Team', ''],
    ['no state', 'State', '']
  ])('holds Create back with %s', async (_why, name, value) => {
    await open()
    fireEvent.change(input(name), { target: { value } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /^Create/ }).disabled).toBe(true)
  })

  it('marks a title over 255 characters invalid and announces why', async () => {
    await open()
    expect(input('Title').getAttribute('aria-invalid')).not.toBe('true')
    fireEvent.change(input('Title'), { target: { value: 'x'.repeat(256) } })
    expect(input('Title').getAttribute('aria-invalid')).toBe('true')
    expect(
      screen.getByText('The title is over 255 characters; shorten it.').getAttribute('aria-live')
    ).toBe('polite')
  })

  it.each([
    ['both screenshots', [], 2],
    ['one screenshot', ['pilot-image:1'], 1],
    ['none', ['pilot-image:1', 'pilot-image:2'], 0]
  ])(
    'waits long enough for Create to sign and upload every ticked screenshot: %s',
    async (_name, untick, ticked) => {
      await open()
      for (const ref of untick) {
        fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(ref) }))
      }
      fireEvent.click(screen.getByRole('button', { name: 'Create WEB ticket' }))
      await waitFor(() => expect(creates()).toHaveLength(1))
      expect(creates()[0][2].timeoutMs).toBeGreaterThan(
        ticked * (LINEAR_UPLOAD_SIGN_TIMEOUT_MS + LINEAR_UPLOAD_PUT_TIMEOUT_MS)
      )
    }
  )

  it('toasts the filed ticket, then hands it back', async () => {
    const { onFiled } = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Create WEB ticket' }))
    await waitFor(() => expect(onFiled).toHaveBeenCalledWith(FILED))
    expect(toastSuccess).toHaveBeenCalledWith('Filed WEB-1482', expect.anything())
    expect(toastSuccess.mock.invocationCallOrder[0]).toBeLessThan(
      onFiled.mock.invocationCallOrder[0]
    )
  })

  it('shows an error Linear never acted on and leaves the draft editable', async () => {
    await open(async () => ({ ok: false, error: 'Label not found', maybeCreated: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Create WEB ticket' }))
    expect((await screen.findByText('Label not found')).getAttribute('aria-live')).toBe('polite')
    expect(fields().every((f) => !f.disabled)).toBe(true)
    expect(screen.queryByText(FROZEN)).toBeNull()
    expect(screen.getByRole('button', { name: 'Create WEB ticket' })).toBeTruthy()
  })

  it('freezes a draft Linear may have created, and Retry resends it unchanged', async () => {
    await open(async () => ({ ok: false, error: 'Linear timed out', maybeCreated: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Create WEB ticket' }))
    expect(await screen.findByText(FROZEN)).toBeTruthy()
    expect(fields().every((f) => f.disabled)).toBe(true)
    // Even a change that slips past the disabled field can't reach the resend.
    fireEvent.change(input('Title'), { target: { value: 'Edited after the freeze' } })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(creates()).toHaveLength(2))
    expect(creates()[1][1]).toEqual(creates()[0][1])
  })

  it('stays frozen when a later Retry answers that nothing was created', async () => {
    const answers: TicketCreateResult[] = [
      { ok: false, error: 'Linear timed out', maybeCreated: true },
      { ok: false, error: 'The card changed; reopen the draft', maybeCreated: false }
    ]
    await open(async () => answers.shift() ?? { ok: true, ...FILED })
    fireEvent.click(screen.getByRole('button', { name: 'Create WEB ticket' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('The card changed; reopen the draft')).toBeTruthy()
    expect(screen.getByText(FROZEN)).toBeTruthy()
    expect(fields().every((f) => f.disabled)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(creates()).toHaveLength(3))
    expect(creates()[2][1]).toEqual(creates()[0][1])
  })

  it('opens frozen on a draft Linear may have created, showing and resending exactly what was filed', async () => {
    const frozen: TicketDraftEdit = {
      title: 'Footer overlaps Save',
      body: '## Evidence\n\n![Before](pilot-image:1)\n',
      team: 'WEB',
      state: 'Todo',
      priority: 'high',
      labels: ['qa'],
      images: ['pilot-image:1']
    }
    await open(undefined, { ...DRAFT, frozen })
    expect(screen.getByText(FROZEN)).toBeTruthy()
    expect(fields().every((f) => f.disabled)).toBe(true)
    expect(
      fields()
        .slice(0, 6)
        .map((f) => f.value)
    ).toEqual(['Footer overlaps Save', 'WEB', 'Todo', 'qa', 'high', frozen.body])
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false'])
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(creates()).toHaveLength(1))
    expect(creates()[0][1]).toEqual({ id: 'in_9', digest: 'draft-digest', draft: frozen })
  })

  it('freezes when the Create call itself fails, since it may have reached Linear', async () => {
    await open(async () => {
      throw new Error('Runtime RPC timed out')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create WEB ticket' }))
    expect(await screen.findByText('Runtime RPC timed out')).toBeTruthy()
    expect(screen.getByText(FROZEN)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('goes Back without a Create', async () => {
    const { onClose } = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(creates()).toHaveLength(0)
  })

  it('says why when the draft cannot be built', async () => {
    pilotRpc.mockRejectedValue(new Error('/skills/ticket.md: no frontmatter'))
    render(<TicketDraftPanel item={ITEM} onClose={vi.fn()} onFiled={vi.fn()} />)
    expect((await screen.findByText(/no frontmatter/)).getAttribute('aria-live')).toBe('polite')
    expect(screen.queryByRole('button', { name: /^Create/ })).toBeNull()
  })

  it('links the ticket filed before for the same finding', async () => {
    await open(undefined, { ...DRAFT, ticketedBefore: { identifier: 'WEB-9', url: FILED.url } })
    expect(screen.getByRole('link', { name: 'Ticketed before · WEB-9' }).getAttribute('href')).toBe(
      FILED.url
    )
  })
})
