// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboxListRow } from '../../../shared/api-types'
import type { HostedSection } from '../../hosts/hosted-sections'
import { LOCAL_NAMED } from '../../hosts/__fixtures__/hosts'
import { inboxRow } from '../../hosts/__fixtures__/inbox-row'
import { InboxRows } from './InboxRows'

afterEach(cleanup)

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
      group: { key: 'g', label: 'web-1', rank: 0 },
      items: items.map((i) => ({ ...i, host }))
    }
  ]
}

// The save never settles unless a test passes its own onAnswer: the row stays saving.
function renderRows(items: InboxListRow[], onAnswer = vi.fn(() => new Promise<null>(() => {}))) {
  const onOpen = vi.fn()
  render(
    <InboxRows
      sections={sectionOf(...items)}
      answerStates={new Map()}
      errors={{}}
      names={new Map([['ci', 'Fix failed CI']])}
      now={1000}
      onAnswer={onAnswer}
      onOpen={onOpen}
    />
  )
  return { onAnswer, onOpen }
}

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
