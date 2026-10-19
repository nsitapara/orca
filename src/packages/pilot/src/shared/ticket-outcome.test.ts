import { describe, expect, it } from 'vitest'
import {
  findingTitle,
  formatTicketedOutcome,
  parseTicketedOutcome,
  ticketRefusal
} from './ticket-outcome'

const ref = { identifier: 'WEB-1482', url: 'https://linear.app/x/issue/WEB-1482' }
const formatted = 'ticketed for later: WEB-1482 · https://linear.app/x/issue/WEB-1482'

describe('ticketed outcome', () => {
  it('formats and round-trips', () => {
    expect(formatTicketedOutcome(ref)).toBe(formatted)
    expect(parseTicketedOutcome(formatted)).toEqual(ref)
  })

  it.each([['done: created WEB-1'], [null], ['ticketed for later: ']])(
    'parses %s as null',
    (outcome) => {
      expect(parseTicketedOutcome(outcome)).toBeNull()
    }
  )
})

describe('findingTitle', () => {
  it.each([
    [
      'F2 Mixed colors — apps/staff/src/Sidebar.tsx:268',
      { title: 'F2 Mixed colors', location: 'apps/staff/src/Sidebar.tsx:268' }
    ],
    ['No location here', { title: 'No location here', location: null }],
    ['A — B', { title: 'A — B', location: null }]
  ])('splits %s', (title, expected) => {
    expect(findingTitle(title)).toEqual(expected)
  })
})

describe('ticketRefusal', () => {
  it.each([
    [{ status: 'open', type: 'flagged', itemKey: 'wt:1' }, null],
    [{ status: 'answered', type: 'flagged', itemKey: 'wt:1' }, 'This card is already answered'],
    [{ status: 'open', type: 'action', itemKey: 'wt:1' }, "An action card's Approve is its effect"],
    [
      { status: 'open', type: 'flagged', itemKey: null },
      "This card has no item key, so it can't be filed"
    ]
  ] as const)('%j -> %s', (card, expected) => {
    expect(ticketRefusal(card)).toBe(expected)
  })
})
