// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { ActivityThreadGroup } from '@/components/activity/activity-thread-types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { registerPilotStore } from '../store'
import {
  LOCAL_LABEL,
  MINI,
  arrangeMachines,
  attach,
  listPaneProps,
  machineGroups,
  machineThread
} from './activity-machines-test-fixtures'
import { ActivityMachinesListPane } from './ActivityMachinesListPane'

afterEach(() => {
  cleanup()
  registerPilotStore(null)
})

function chipLabels(groups: ActivityThreadGroup[]): (string | null)[] {
  render(
    <TooltipProvider>
      <ActivityMachinesListPane {...listPaneProps(groups)} />
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
