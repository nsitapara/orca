// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorktreeTimeline } from '../../shared/api-types'
import { PILOT_TAB } from '../../shared/sidebar-click'
import { inboxItem, timelineRun, worktreeTimeline } from '../timeline/timeline.fixtures'

let failing = false
let feed: { data: WorktreeTimeline | null; error: string | null } = { data: null, error: null }
vi.mock('./active-worktree', () => ({ useActiveWorktreePath: () => '/wt/a' }))
vi.mock('./timeline-feed', () => ({
  useWorktreeTimeline: () => {
    if (failing) {
      throw new Error('Pilot failed')
    }
    return feed
  }
}))

import { PilotActivityBadge } from './PilotActivityBadge'

describe('PilotActivityBadge', () => {
  afterEach(() => {
    cleanup()
    feed = { data: null, error: null }
  })

  it('draws nothing on any other activity item', () => {
    feed = { data: worktreeTimeline({ waiting: [inboxItem()] }), error: null }
    const { container } = render(<PilotActivityBadge itemId="checks" layout="top" />)
    expect(container.innerHTML).toBe('')
  })

  it('counts what waits on you in this worktree', () => {
    feed = {
      data: worktreeTimeline({ waiting: [inboxItem(), inboxItem({ id: 'i2' })] }),
      error: null
    }
    render(<PilotActivityBadge itemId={PILOT_TAB} layout="side" />)
    expect(screen.getByLabelText('2 waiting on you').textContent).toBe('2')
  })

  it('shows a dot while a run is going here', () => {
    feed = { data: worktreeTimeline({ now: [timelineRun({ status: 'running' })] }), error: null }
    render(<PilotActivityBadge itemId={PILOT_TAB} layout="top" />)
    expect(screen.getByLabelText('An automation is running here')).toBeTruthy()
  })

  it('draws nothing, and does not unmount its parent, when Pilot fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    failing = true
    render(
      <div data-testid="bar">
        <PilotActivityBadge itemId={PILOT_TAB} layout="top" />
      </div>
    )
    expect(screen.getByTestId('bar').innerHTML).toBe('')
    failing = false
  })
})
