// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InboxFilters } from './InboxFilters'
import { InboxHeader } from './InboxHeader'
import { InboxTabs } from './InboxTabs'

afterEach(cleanup)

function tabs(over: Partial<Parameters<typeof InboxTabs>[0]> = {}) {
  const onTab = vi.fn()
  render(
    <InboxTabs
      tab="needs_you"
      counts={{ needs_you: 8, preparing: 9, blocked: 0, all: 17 }}
      preparingNote={null}
      doneCount={2}
      onTab={onTab}
      {...over}
    />
  )
  return onTab
}

function filters(over: Partial<Parameters<typeof InboxFilters>[0]> = {}) {
  const handlers = {
    onFilters: vi.fn(),
    onGroup: vi.fn(),
    onSort: vi.fn(),
    onView: vi.fn()
  }
  render(
    <InboxFilters
      filters={{ kinds: [], query: '' }}
      kindCounts={{ question: 3, bug: 1 }}
      shown={8}
      total={8}
      group="worktree"
      sort="kind"
      view="cards"
      {...handlers}
      {...over}
    />
  )
  return handlers
}

describe('InboxTabs', () => {
  it('shows each tab with its count and omits Blocked at zero', () => {
    tabs()
    expect(screen.getByRole('button', { name: 'Needs you · 8' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Preparing · 9' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'All · 17' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Blocked/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Needs you · 8' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })

  it('shows Blocked when something is blocked', () => {
    tabs({ counts: { needs_you: 1, preparing: 0, blocked: 2, all: 3 } })
    expect(screen.getByRole('button', { name: 'Blocked · 2' })).toBeTruthy()
  })

  it('selects a tab on click', () => {
    const onTab = tabs()
    fireEvent.click(screen.getByRole('button', { name: 'Preparing · 9' }))
    expect(onTab).toHaveBeenCalledWith('preparing')
  })

  it('shows the preparing note', () => {
    tabs({ preparingNote: '8 waiting' })
    expect(screen.getByText('8 waiting')).toBeTruthy()
  })
})

describe('InboxFilters', () => {
  it('lists only kinds that have cards', () => {
    filters()
    expect(screen.getByRole('button', { name: 'Questions · 3' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bugs · 1' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Approvals/ })).toBeNull()
  })

  it('toggles a kind', () => {
    const { onFilters } = filters()
    fireEvent.click(screen.getByRole('button', { name: 'Questions · 3' }))
    expect(onFilters).toHaveBeenCalledWith({ kinds: ['question'], query: '' })
  })

  it('offers Clear with the shown count when a filter is on', () => {
    filters({ filters: { kinds: ['question'], query: '' }, shown: 3 })
    expect(screen.getByRole('button', { name: 'Clear · 3 of 8 shown' })).toBeTruthy()
  })

  it('changes search, group, sort and view', () => {
    const h = filters()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search cards' }), {
      target: { value: 'abc' }
    })
    expect(h.onFilters).toHaveBeenCalledWith({ kinds: [], query: 'abc' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Group by' }), {
      target: { value: 'job' }
    })
    expect(h.onGroup).toHaveBeenCalledWith('job')
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), {
      target: { value: 'oldest' }
    })
    expect(h.onSort).toHaveBeenCalledWith('oldest')
    fireEvent.click(screen.getByRole('button', { name: 'Rows' }))
    expect(h.onView).toHaveBeenCalledWith('rows')
  })
})

describe('InboxHeader', () => {
  it('no longer carries the waiting count', () => {
    const { container } = render(
      <InboxHeader
        listOpen
        onToggleList={() => {}}
        people={[]}
        viewer={null}
        onViewer={() => {}}
        wide
        canExpand={false}
        allOpen={false}
        onToggleAll={() => {}}
      />
    )
    expect(container.textContent).not.toContain('waiting')
  })
})
