// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { withGroupRows } from '../activity-tabs/activity-tabs-rows'
import { registerPilotStore } from '../store'
import {
  LOCAL_LABEL,
  MINI,
  arrangeMachines,
  attach,
  machineGroups,
  machineThread,
  pilotRow
} from './activity-machines-test-fixtures'
import { useActivityMachineChips } from './use-activity-machine-chips'

afterEach(() => {
  cleanup()
  registerPilotStore(null)
})

it('is null until Pilot attaches', () => {
  arrangeMachines()
  const groups = machineGroups(machineThread('a'), machineThread('b', MINI))
  expect(renderHook(() => useActivityMachineChips(groups)).result.current).toBeNull()
})

it.each(['tab', 'recent-worktree'] as const)('counts a Pilot %s row toward the span', (kind) => {
  attach()
  arrangeMachines()
  const group = withGroupRows(machineGroups(machineThread('a'))[0], [pilotRow(kind, MINI)])
  const chips = renderHook(() => useActivityMachineChips([group])).result.current
  expect(chips && Object.fromEntries(chips.labels)).toEqual({
    local: LOCAL_LABEL,
    [MINI]: 'Mac mini'
  })
})

it('keeps its value while the machines and labels stay the same', () => {
  attach()
  arrangeMachines()
  const { result, rerender } = renderHook(({ groups }) => useActivityMachineChips(groups), {
    initialProps: { groups: machineGroups(machineThread('a'), machineThread('b', MINI)) }
  })
  const first = result.current
  rerender({
    groups: machineGroups(machineThread('c', MINI), machineThread('a'), machineThread('d'))
  })
  expect(result.current).toBe(first)
})
