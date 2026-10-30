// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { registerPilotStore } from '../store'
import { useActivityReviewVisibility } from './activity-review-visibility'

function Row({ worktreeId }: { worktreeId: string }): null {
  useActivityReviewVisibility(worktreeId)
  return null
}

const visibleIds = (): readonly string[] => useAppStore.getState().visibleReviewCardWorktreeIds

describe('useActivityReviewVisibility', () => {
  afterEach(() => {
    cleanup()
    useAppStore.getState().setVisibleReviewCardWorktreeIds([])
    registerPilotStore(null)
  })

  it('keeps an Activity row in the visible review set beside the Workspaces list until it unmounts', () => {
    registerPilotStore(useAppStore)
    useAppStore.getState().setVisibleReviewCardWorktreeIds(['list-a'])
    const first = render(<Row worktreeId="activity-b" />)
    const second = render(<Row worktreeId="activity-b" />)
    expect(visibleIds()).toEqual(['list-a', 'activity-b'])

    // The Workspaces list publishes [] when it unmounts; Activity rows keep their place.
    useAppStore.getState().setVisibleReviewCardWorktreeIds([])
    expect(visibleIds()).toEqual(['activity-b'])

    first.unmount()
    expect(visibleIds()).toEqual(['activity-b'])
    second.unmount()
    expect(visibleIds()).toEqual([])
  })
})
