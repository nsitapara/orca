// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { locateActivityWorktree } from './locate-worktree'

// A stand-in for Activity's virtual list: rows mount only once the list scrolls to them.
function virtualList(rows: { worktree: string; at: number; session?: boolean }[]) {
  const list = document.createElement('div')
  list.style.overflowY = 'auto'
  Object.defineProperty(list, 'clientHeight', { value: 100 })
  Object.defineProperty(list, 'scrollHeight', { value: 1000 })
  let top = 400
  const scrolled = vi.fn()
  const mount = (): void => {
    list.replaceChildren()
    for (const row of rows) {
      if (row.at >= top && row.at < top + 100) {
        const element = document.createElement('div')
        element.setAttribute(
          row.session ? 'data-pilot-session-worktree' : 'data-pilot-worktree-header',
          row.worktree
        )
        element.scrollIntoView = () => scrolled(row.worktree, row.session === true)
        list.append(element)
      }
    }
  }
  Object.defineProperty(list, 'scrollTop', {
    get: () => top,
    set: (next: number) => {
      top = Math.min(next, 900)
      mount()
    }
  })
  mount()
  document.body.append(list)
  return { scrolled }
}

const deps = (expandInactive = vi.fn()) => ({
  root: document,
  nextFrame: (callback: () => void) => callback(),
  inactiveExpanded: () => false,
  expandInactive
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('locate a worktree in Activity', () => {
  it.each([
    { name: 'a mounted header', target: 'wt-in-view', scrolledTo: [['wt-in-view', false]] },
    { name: 'a header off screen', target: 'wt-top', scrolledTo: [['wt-top', false]] },
    {
      name: 'a header whose session is mounted',
      target: 'wt-session',
      scrolledTo: [
        ['wt-session', true],
        ['wt-session', false]
      ]
    }
  ])('scrolls to $name', ({ target, scrolledTo }) => {
    const { scrolled } = virtualList([
      { worktree: 'wt-in-view', at: 450 },
      { worktree: 'wt-top', at: 10 },
      { worktree: 'wt-other', at: 420 },
      { worktree: 'wt-session', at: 480, session: true },
      { worktree: 'wt-session', at: 800 }
    ])
    locateActivityWorktree(target, deps())
    expect(scrolled.mock.calls).toEqual(scrolledTo)
  })

  it('unfolds Inactive once when the whole list lacks it, and stops when still not found', () => {
    const { scrolled } = virtualList([{ worktree: 'wt-in-view', at: 450 }])
    const expandInactive = vi.fn()
    locateActivityWorktree('wt-inactive', deps(expandInactive))
    expect(expandInactive).toHaveBeenCalledTimes(1)
    expect(scrolled).not.toHaveBeenCalled()
  })
})
