// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { useContext } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  ActivityThreadCollapseContext,
  type ActivityThreadCollapseState
} from '@/components/activity/activity-thread-collapse-context'
import { useAppStore } from '@/store'
import { registerPilotStore } from '../store'
import { WorktreeFoldCollapseProvider } from './WorktreeFoldCollapseProvider'

afterEach(() => {
  cleanup()
  registerPilotStore(null)
})

const probe: { state: ActivityThreadCollapseState | null } = { state: null }

function Probe(): null {
  probe.state = useContext(ActivityThreadCollapseContext)
  return null
}

// The sidebar's set; a worktree key in it is ignored, Pilot's saved set decides those.
const host = {
  collapsedGroupKeys: new Set(['done', 'worktree:stale']),
  onToggleGroupCollapse: vi.fn()
}

const saved = () =>
  JSON.parse(window.localStorage.getItem('pilot.activity.folded-worktrees') ?? '[]')

// Why: Pilot relaunches on every rebuild, so a worktree's fold is saved; every other group keeps the
// host's set (the sidebar's), or the pane's own where there is none (the Activity page).
it.each([{ withHost: true }, { withHost: false }])(
  'a worktree group folds in Pilot’s saved set, any other in the host’s (host: $withHost)',
  ({ withHost }) => {
    registerPilotStore(useAppStore)
    host.onToggleGroupCollapse.mockClear()
    const tree = (
      <WorktreeFoldCollapseProvider>
        <Probe />
      </WorktreeFoldCollapseProvider>
    )
    render(
      withHost ? (
        <ActivityThreadCollapseContext.Provider value={host}>
          {tree}
        </ActivityThreadCollapseContext.Provider>
      ) : (
        tree
      )
    )
    const keys = () => [...probe.state!.collapsedGroupKeys]
    expect(keys()).toEqual(withHost ? ['done'] : [])

    act(() => probe.state!.onToggleGroupCollapse('worktree:wt-1'))
    expect(saved()).toEqual(['worktree:wt-1'])
    act(() => probe.state!.onToggleGroupCollapse('working'))
    expect(host.onToggleGroupCollapse).toHaveBeenCalledTimes(withHost ? 1 : 0)
    expect(keys()).toEqual(withHost ? ['done', 'worktree:wt-1'] : ['working', 'worktree:wt-1'])

    act(() => probe.state!.onToggleGroupCollapse('worktree:wt-1'))
    expect(saved()).toEqual([])
  }
)
