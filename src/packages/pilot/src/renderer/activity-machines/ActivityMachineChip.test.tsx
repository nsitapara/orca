// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type {
  ActivityGroupBy,
  ActivityThreadGroup
} from '@/components/activity/activity-thread-types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { withGroupRows } from '../activity-tabs/activity-tabs-rows'
import { registerPilotStore } from '../store'
import {
  LOCAL_LABEL,
  MINI,
  arrangeMachines,
  attach,
  listPaneProps,
  machineGroups,
  machineThread,
  pilotRow
} from './activity-machines-test-fixtures'
import { ActivityMachinesListPane } from './ActivityMachinesListPane'

vi.mock('../activity-tabs/NewAgentMenu', () => ({ NewAgentMenu: () => null }))

afterEach(() => {
  cleanup()
  registerPilotStore(null)
})

function chipLabels(
  groups: ActivityThreadGroup[],
  groupBy: ActivityGroupBy = 'none'
): (string | null)[] {
  render(
    <TooltipProvider>
      <ActivityMachinesListPane {...listPaneProps(groups)} groupBy={groupBy} />
    </TooltipProvider>
  )
  return [...document.querySelectorAll('[data-variant="hostContext"]')].map(
    (node) => node.textContent
  )
}

it.each([
  {
    name: 'rows on two machines name their machine',
    threads: [machineThread('a'), machineThread('b', MINI)],
    chips: [LOCAL_LABEL, 'Mac mini']
  },
  {
    name: 'rows on one machine carry no chip',
    threads: [machineThread('a'), machineThread('b')],
    chips: []
  }
])('$name', ({ threads, chips }) => {
  attach()
  arrangeMachines()
  expect(chipLabels(machineGroups(...threads))).toEqual(chips)
})

it.each(['tab', 'recent-worktree'] as const)(
  'a Pilot %s row on another machine names it',
  (kind) => {
    attach()
    arrangeMachines()
    const group = withGroupRows(machineGroups(machineThread('a'))[0], [pilotRow(kind, MINI)])
    expect(chipLabels([group])).toEqual([LOCAL_LABEL, 'Mac mini'])
  }
)

// Grouped by worktree, a recent or pinned worktree is its group's header, not a row under it.
it('grouped by worktree, a header-only worktree on another machine names it', () => {
  attach()
  arrangeMachines()
  const local = { key: 'worktree:wt-a', label: 'main', threads: [machineThread('a')] }
  const remote = withGroupRows({ key: 'worktree:wt-recent-worktree', label: 'main', threads: [] }, [
    pilotRow('recent-worktree', MINI)
  ])
  // The local header, its session, then the remote header.
  expect(chipLabels([local, remote], 'worktree')).toEqual([LOCAL_LABEL, LOCAL_LABEL, 'Mac mini'])
})
