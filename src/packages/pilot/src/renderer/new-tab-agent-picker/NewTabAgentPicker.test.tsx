// @vitest-environment happy-dom
import { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../../shared/constants'
import type { TuiAgent } from '../../../../../shared/tui-agent'
import { useAppStore } from '@/store'
import { registerPilotStore } from '../store'
import { NewTabAgentPicker } from './NewTabAgentPicker'
import {
  openNewTabAgentPickerOr,
  useNewTabAgentPickerOpen
} from './new-tab-agent-picker-open-state'
import {
  NEW_TAB_MACHINE_KEY,
  readLastNewTabMachine,
  rememberNewTabMachine
} from './new-tab-machine-memory'
import type { NewTabMachineStep } from './new-tab-machine-step'
import { machineTarget, PROJECT } from './new-tab-machine-test-fixtures'

const launches = vi.hoisted((): unknown[] => [])
const machineStep = vi.hoisted((): { value: NewTabMachineStep | null } => ({ value: null }))
const detections = vi.hoisted((): Record<string, TuiAgent[]> => ({}))
vi.mock('@/hooks/useDetectedAgents', () => ({
  useDetectedAgents: () => ({ detectedIds: ['claude', 'codex'], isLoading: false })
}))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: (args: unknown) => {
    launches.push(args)
    return { surface: { kind: 'host-published' } }
  }
}))
vi.mock('./use-new-tab-machine-step', () => ({
  useNewTabMachineStep: () => machineStep.value
}))
vi.mock('@/lib/agent-detection-target-inventory', () => ({
  readDetectedAgentsForWorktree: (_state: unknown, id: string) => detections[id] ?? null,
  ensureDetectedAgentsForWorktree: vi.fn()
}))

const here = machineTarget('local', 'wt-1', {
  isCurrent: true,
  opensIn: 'this-workspace',
  worktreeName: 'feat',
  machineLabel: 'Local Mac'
})
const there = machineTarget('runtime:env-b', 'repo-b::/b/feat', {
  opensIn: 'same-branch',
  worktreeName: 'feat',
  machineLabel: 'Second Mac'
})
const TWO: NewTabMachineStep = { projectId: PROJECT, targets: [here, there] }

const enter = (input: HTMLElement): boolean => fireEvent.keyDown(input, { key: 'Enter' })
const arrowDown = (input: HTMLElement, times: number): void => {
  for (let i = 0; i < times; i++) {
    fireEvent.keyDown(input, { key: 'ArrowDown' })
  }
}
const selected = (): string | null => screen.getByRole('option', { selected: true }).textContent
const nextFrame = (): Promise<void> =>
  act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

afterEach(() => {
  cleanup()
  act(() => useNewTabAgentPickerOpen.setState({ open: false }))
  registerPilotStore(null)
  launches.length = 0
  localStorage.clear()
  for (const id of Object.keys(detections)) {
    delete detections[id]
  }
  machineStep.value = null
})

describe('openNewTabAgentPickerOr', () => {
  it.each([
    { attached: true, pickerOpen: true, bareTerminals: 0 },
    { attached: false, pickerOpen: false, bareTerminals: 1 }
  ])(
    'attached=$attached: picker open $pickerOpen, bare terminals $bareTerminals',
    ({ attached, pickerOpen, bareTerminals }) => {
      registerPilotStore(attached ? useAppStore : null)
      const openTerminal = vi.fn()
      openNewTabAgentPickerOr(openTerminal)
      expect(useNewTabAgentPickerOpen.getState().open).toBe(pickerOpen)
      expect(openTerminal).toHaveBeenCalledTimes(bareTerminals)
    }
  )
})

describe('NewTabAgentPicker', () => {
  beforeEach(() => {
    registerPilotStore(useAppStore)
    useAppStore.setState({
      settings: { ...getDefaultSettings('/home'), defaultTuiAgent: 'codex' },
      activeGroupIdByWorktree: { 'wt-1': 'g' }
    })
  })

  function openPicker(): { handleNewTab: () => void; input: HTMLElement } {
    const handleNewTab = vi.fn()
    render(<NewTabAgentPicker controller={{ activeWorktreeId: 'wt-1', handleNewTab }} />)
    act(() => useNewTabAgentPickerOpen.setState({ open: true }))
    return { handleNewTab, input: screen.getByPlaceholderText('Open a new tab with...') }
  }

  it('lists the default agent first and selected, then the others, then Blank Terminal', () => {
    openPicker()
    const options = screen.getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'CodexDefault',
      'Claude',
      'Blank Terminal'
    ])
    expect(options[0]?.getAttribute('aria-selected')).toBe('true')
  })

  it.each([
    {
      typed: '',
      launches: [{ agent: 'codex', worktreeId: 'wt-1', groupId: 'g', launchSource: 'shortcut' }],
      bareTerminals: 0
    },
    { typed: 'terminal', launches: [], bareTerminals: 1 },
    { typed: 'terminal', step: TWO, launches: [], bareTerminals: 1 }
  ])('Enter after typing "$typed" opens the selected row and closes', async (row) => {
    machineStep.value = row.step ?? null
    const { handleNewTab, input } = openPicker()
    fireEvent.change(input, { target: { value: row.typed } })
    enter(input)
    await nextFrame()
    expect(launches).toEqual(row.launches.map((launch) => expect.objectContaining(launch)))
    expect(handleNewTab).toHaveBeenCalledTimes(row.bareTerminals)
    expect(useNewTabAgentPickerOpen.getState().open).toBe(false)
    expect(localStorage.getItem(NEW_TAB_MACHINE_KEY)).toBeNull()
  })

  it('Enter, Enter opens on the current machine and remembers it', async () => {
    machineStep.value = TWO
    const { input } = openPicker()
    enter(input)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Local Macfeat · this workspaceCurrent',
      'Second Macfeat · same branch'
    ])
    enter(input)
    await nextFrame()
    expect(launches).toEqual([expect.objectContaining({ agent: 'codex', worktreeId: 'wt-1' })])
    expect(readLastNewTabMachine(PROJECT)).toBe('local')
  })

  it('starts on the machine last picked for the project', async () => {
    machineStep.value = TWO
    rememberNewTabMachine(PROJECT, 'runtime:env-b')
    detections['repo-b::/b/feat'] = ['codex']
    const { input } = openPicker()
    enter(input)
    expect(selected()).toContain('Second Mac')
    enter(input)
    await nextFrame()
    expect(launches).toEqual([
      expect.objectContaining({ agent: 'codex', worktreeId: 'repo-b::/b/feat' })
    ])
  })

  it('disables a machine without the agent and starts on the current one', () => {
    machineStep.value = TWO
    rememberNewTabMachine(PROJECT, 'runtime:env-b')
    detections['repo-b::/b/feat'] = ['claude']
    const { input } = openPicker()
    enter(input)
    expect(screen.getByRole('option', { name: /Second Mac/ }).getAttribute('aria-disabled')).toBe(
      'true'
    )
    expect(screen.getByText('Codex not found here')).toBeTruthy()
    expect(selected()).toContain('Local Mac')
  })

  it('moves the highlight off a machine whose agent check comes back without the agent', async () => {
    machineStep.value = TWO
    rememberNewTabMachine(PROJECT, 'runtime:env-b')
    const { input } = openPicker()
    enter(input)
    expect(selected()).toContain('Second Mac')
    act(() => {
      detections['repo-b::/b/feat'] = ['claude']
      useAppStore.setState({})
    })
    expect(selected()).toContain('Local Mac')
    enter(input)
    await nextFrame()
    expect(launches).toEqual([expect.objectContaining({ worktreeId: 'wt-1' })])
  })

  it.each([
    { agentMoves: 0, machineMoves: 0, agent: 'CodexDefault' },
    { agentMoves: 1, machineMoves: 1, agent: 'Claude' }
  ])(
    'Esc on the machine step goes back to $agent with the dialog open',
    ({ agentMoves, machineMoves, agent }) => {
      machineStep.value = TWO
      const { input } = openPicker()
      arrowDown(input, agentMoves)
      enter(input)
      arrowDown(input, machineMoves)
      fireEvent.keyDown(input, { key: 'Escape' })
      expect(useNewTabAgentPickerOpen.getState().open).toBe(true)
      expect(screen.getByPlaceholderText('Open a new tab with...')).toBeTruthy()
      expect(selected()).toBe(agent)
    }
  )
})
