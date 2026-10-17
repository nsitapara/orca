// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { registerPilotStore } from '../store'
import {
  MINI,
  arrangeMachines,
  attach,
  listPaneProps,
  machineGroups,
  machineThread
} from './activity-machines-test-fixtures'
import { ActivityMachinesListPane } from './ActivityMachinesListPane'

const pane = vi.hoisted(() => ({ renders: 0 }))

vi.mock('@/components/activity/activity-thread-list-pane', () => ({
  ActivityThreadListPane: () => {
    pane.renders += 1
    return null
  }
}))

afterEach(() => {
  cleanup()
  registerPilotStore(null)
})

it.each([
  {
    name: 'host status changes',
    write: () => useAppStore.setState({ runtimeStatusByEnvironmentId: new Map() })
  },
  {
    name: 'a setting the hosts don’t read changes',
    write: () =>
      useAppStore.setState(({ settings }) => ({
        settings: settings && { ...settings, editorPreviewTabsEnabled: false }
      }))
  }
])('leaves the list alone when only $name', ({ write }) => {
  attach()
  arrangeMachines()
  render(
    <ActivityMachinesListPane
      {...listPaneProps(machineGroups(machineThread('a'), machineThread('b', MINI)))}
    />
  )
  const before = pane.renders
  act(write)
  expect(pane.renders).toBe(before)
})
