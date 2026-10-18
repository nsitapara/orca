// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxListRow } from '../../../shared/api-types'
import type { AnswerState } from '../../../shared/inbox-types'
import type { HostedSection } from '../../hosts/hosted-sections'
import { LOCAL_NAMED, MINI } from '../../hosts/__fixtures__/hosts'
import { inboxRow } from '../../hosts/__fixtures__/inbox-row'
import { resetPilotHostsFeed, setPilotHostsForTests } from '../../hosts/pilot-hosts-feed'
import { InboxRows } from './InboxRows'

afterEach(() => {
  cleanup()
  resetPilotHostsFeed()
})

function card(over: Partial<InboxListRow>): InboxListRow {
  return inboxRow({
    type: 'action',
    title: 'Push the fix?',
    options: [
      { label: 'Approve', meaning: 'push' },
      { label: 'Skip', meaning: 'keep local' }
    ],
    ...over
  })
}

function sectionOf(...items: InboxListRow[]): HostedSection[] {
  const host = LOCAL_NAMED
  return [
    {
      key: 'g',
      host,
      group: { key: 'wt:/w/web-1', label: 'web-1', rank: 0 },
      items: items.map((i) => ({ ...i, host }))
    }
  ]
}

// The save never settles unless a test passes its own onAnswer: the row stays saving.
function renderRows(items: InboxListRow[], onAnswer = vi.fn(() => new Promise<null>(() => {}))) {
  const onOpen = vi.fn()
  const rows = (shown: InboxListRow[], answerStates: ReadonlyMap<string, AnswerState>) => (
    <InboxRows
      sections={sectionOf(...shown)}
      answerStates={answerStates}
      errors={{}}
      names={new Map([['ci', 'Fix failed CI']])}
      places={new Map([['in_1', 'web-1']])}
      now={1000}
      onAnswer={onAnswer}
      onOpen={onOpen}
    />
  )
  const { rerender } = render(rows(items, new Map()))
  // The next reload: these cards, with these answer states by hostedKey.
  const reload = (shown: InboxListRow[], answerStates: ReadonlyMap<string, AnswerState>) =>
    rerender(rows(shown, answerStates))
  return { onAnswer, onOpen, reload }
}

const answerState = (locked: boolean): AnswerState => ({
  locked,
  sentBeforePilot: false,
  state: 'not_ready',
  readyAt: 61_000,
  reason: null
})
const ANSWERED = card({
  status: 'answered',
  answer: { option: 0, text: 'approve', digest: 'd1', via: 'page' }
})

describe('InboxRows', () => {
  it('a ready approval row answers Approve in one click, as AnswerRow would', () => {
    const { onAnswer } = renderRows([card({})])
    expect(screen.getByRole('region', { name: 'web-1' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ id: 'in_1' }), {
      option: 0,
      text: 'approve'
    })
  })

  it('a quick answer sends once, however fast it is clicked twice', () => {
    const { onAnswer } = renderRows([card({})])
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onAnswer).toHaveBeenCalledOnce()
  })

  it("offers Undo after a quick answer while the answer is unlocked, sending what the card's Undo sends", async () => {
    const { onAnswer, reload } = renderRows(
      [card({})],
      vi.fn(async () => null)
    )
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(onAnswer).toHaveBeenCalledOnce())
    reload([ANSWERED], new Map([['in_1', answerState(false)]]))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(onAnswer).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'in_1' }), {
      option: null,
      text: ''
    })
  })

  it('offers no Undo once the answer is locked', () => {
    const { reload } = renderRows([card({})])
    reload([ANSWERED], new Map([['in_1', answerState(true)]]))
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('names where the card is when the sections are not worktrees, and its machine', () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    render(
      <InboxRows
        sections={[
          {
            ...sectionOf(card({}))[0],
            group: { key: 'kind:Approvals', label: 'Approvals', rank: 2 }
          }
        ]}
        answerStates={new Map()}
        errors={{}}
        names={new Map()}
        places={new Map([['in_1', 'web-2099-carrier']])}
        now={1000}
        onAnswer={vi.fn(async () => null)}
        onOpen={vi.fn()}
      />
    )
    const row = screen.getByRole('listitem')
    expect(within(row).getByText('web-2099-carrier')).toBeTruthy()
    expect(within(row).getByText('MacBook')).toBeTruthy()
  })

  it('does not repeat the worktree its section already names', () => {
    renderRows([card({})])
    expect(within(screen.getByRole('listitem')).queryByText('web-1')).toBeNull()
  })

  it('a queued card has no quick answer', () => {
    renderRows([
      card({
        preparation: {
          state: 'queued',
          revision: 1,
          attempt: 0,
          maxAttempts: 3,
          progress: '',
          error: null,
          updatedAt: 1,
          input: { requirements: ['diff'] }
        }
      })
    ])
    const row = screen.getByRole('listitem')
    expect(within(row).queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(within(row).getByRole('button', { name: 'Open' })).toBeTruthy()
  })

  it('Open reports the item', () => {
    const { onOpen } = renderRows([card({})])
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'in_1' }))
  })
})
