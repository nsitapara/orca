// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InboxHeader } from './InboxHeader'
import { InboxTabs } from './InboxTabs'
import { InboxViewControls } from './InboxViewControls'
import { KindChips, type KindFilterProps, KindSection } from './KindFilter'

afterEach(cleanup)

function tabs(over: Partial<Parameters<typeof InboxTabs>[0]> = {}) {
  const onTab = vi.fn()
  render(
    <InboxTabs
      tab="needs_you"
      counts={{ needs_you: 8, preparing: 9, blocked: 0, all: 17 }}
      preparingNote={null}
      onTab={onTab}
      {...over}
    />
  )
  return onTab
}

function kindsIn(
  Kinds: typeof KindChips | typeof KindSection,
  over: Partial<KindFilterProps> = {}
) {
  const onKinds = vi.fn()
  render(
    <Kinds
      kinds={[]}
      counts={{ question: 3, bug: 1 }}
      shown={8}
      total={8}
      onKinds={onKinds}
      {...over}
    />
  )
  return onKinds
}

function controls() {
  const handlers = { onGroup: vi.fn(), onSort: vi.fn(), onView: vi.fn() }
  render(<InboxViewControls group="worktree" sort="kind" view="cards" {...handlers} />)
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

  it('keeps Blocked at zero while it is the tab, so the tab on screen is never hidden', () => {
    tabs({ tab: 'blocked' })
    expect(screen.getByRole('button', { name: 'Blocked · 0' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })

  it('selects a tab on click', () => {
    const onTab = tabs()
    fireEvent.click(screen.getByRole('button', { name: 'Preparing · 9' }))
    expect(onTab).toHaveBeenCalledWith('preparing')
  })

  it('shows the preparing note right after the Preparing tab, saying what it waits on', () => {
    tabs({
      preparingNote: '8 waiting',
      counts: { needs_you: 1, preparing: 9, blocked: 2, all: 12 }
    })
    const note = screen.getByText('8 waiting')
    expect(note.previousElementSibling).toBe(screen.getByRole('button', { name: 'Preparing · 9' }))
    expect(note.getAttribute('title')).toBe('waiting for the runner')
  })
})

describe.each([
  ['the chips row', KindChips],
  ['the list section', KindSection]
])('kinds in %s', (_where, Kinds) => {
  it('lists only kinds that have cards', () => {
    kindsIn(Kinds)
    expect(screen.getByRole('button', { name: 'Questions · 3' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bugs · 1' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Approvals/ })).toBeNull()
  })

  it('toggles a kind', () => {
    const onKinds = kindsIn(Kinds)
    fireEvent.click(screen.getByRole('button', { name: 'Questions · 3' }))
    expect(onKinds).toHaveBeenCalledWith(['question'])
  })

  it('offers All with every card, pressed until a kind is picked, and picking it clears them', () => {
    kindsIn(Kinds)
    expect(screen.getByRole('button', { name: 'All · 8' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
    cleanup()
    const onKinds = kindsIn(Kinds, { kinds: ['question'], shown: 3 })
    const all = screen.getByRole('button', { name: 'All · 8' })
    expect(all.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(all)
    expect(onKinds).toHaveBeenCalledWith([])
  })

  it('offers nothing, not even All, when no kind has a card', () => {
    kindsIn(Kinds, { counts: {}, total: 0 })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps a pressed kind visible at zero and unpresses it on click', () => {
    const onKinds = kindsIn(Kinds, { kinds: ['bug'], counts: {} })
    const kind = screen.getByRole('button', { name: 'Bugs · 0' })
    expect(kind.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(kind)
    expect(onKinds).toHaveBeenCalledWith([])
  })
})

describe('the list’s Kind section', () => {
  afterEach(() => window.localStorage.clear())

  it('folds away, with Clear standing in for All, and stays folded next time', () => {
    kindsIn(KindSection, { kinds: ['question'], shown: 3 })
    expect(screen.queryByRole('button', { name: /^Clear/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Kind' }))
    expect(screen.queryByRole('button', { name: 'Questions · 3' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Clear · 3 of 8 shown' })).toBeTruthy()
    cleanup()
    kindsIn(KindSection)
    expect(screen.getByRole('button', { name: 'Kind' }).getAttribute('aria-expanded')).toBe('false')
  })
})

describe('InboxViewControls', () => {
  it('offers the agreed group, sort and view labels', () => {
    controls()
    const names = (label: string) =>
      Array.from(screen.getByRole('combobox', { name: label }).querySelectorAll('option')).map(
        (o) => o.textContent
      )
    expect(names('Group by')).toEqual(['Worktree', 'Job', 'Kind', 'Age', 'Nothing'])
    expect(names('Sort')).toEqual(['Kind, then oldest', 'Oldest first', 'Newest first'])
    for (const name of ['Cards', 'Rows', 'One at a time']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })

  it('changes group, sort and view', () => {
    const h = controls()
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
        wide
        canExpand={false}
        allOpen={false}
        onToggleAll={() => {}}
        tabs={null}
        controls={null}
      />
    )
    expect(container.textContent).not.toContain('waiting')
  })
})
