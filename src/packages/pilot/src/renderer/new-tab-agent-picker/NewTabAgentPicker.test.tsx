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
const box = machineTarget('ssh:box', 'repo-c::/c/feat', {
  worktreeName: 'feat',
  machineLabel: 'Build Box'
})
const TWO: NewTabMachineStep = { projectId: PROJECT, targets: [here, there] }
// The current workspace is on Second Mac, so the current machine isn't the first row.
const ON_SECOND_MAC: NewTabMachineStep = {
  projectId: PROJECT,
  targets: [
    machineTarget('local', 'repo-a::/a/feat', { worktreeName: 'feat', machineLabel: 'Local Mac' }),
    machineTarget('runtime:env-b', 'wt-1', {
      isCurrent: true,
      opensIn: 'this-workspace',
      worktreeName: 'feat',
      machineLabel: 'Second Mac'
    })
  ]
}

// Why re-query: each step mounts its own search box.
const searchBox = (): HTMLElement => screen.getByRole('combobox')
const enter = (): boolean => fireEvent.keyDown(searchBox(), { key: 'Enter' })
// Why the keydown: a real keystroke reaches the dialog before the change does.
const type = (value: string): boolean => {
  fireEvent.keyDown(searchBox(), { key: value.at(-1) ?? 'Backspace' })
  return fireEvent.change(searchBox(), { target: { value } })
}
const arrowDown = (times: number): void => {
  for (let i = 0; i < times; i++) {
    fireEvent.keyDown(searchBox(), { key: 'ArrowDown' })
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

  function openPicker(): { handleNewTab: () => void; rerender: () => void } {
    const handleNewTab = vi.fn()
    const controller = { activeWorktreeId: 'wt-1', handleNewTab }
    const view = render(<NewTabAgentPicker controller={controller} />)
    act(() => useNewTabAgentPickerOpen.setState({ open: true }))
    expect(screen.getByPlaceholderText('Open a new tab with...')).toBe(searchBox())
    return {
      handleNewTab,
      rerender: () => view.rerender(<NewTabAgentPicker controller={{ ...controller }} />)
    }
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
    const { handleNewTab } = openPicker()
    type(row.typed)
    enter()
    await nextFrame()
    expect(launches).toEqual(row.launches.map((launch) => expect.objectContaining(launch)))
    expect(handleNewTab).toHaveBeenCalledTimes(row.bareTerminals)
    expect(useNewTabAgentPickerOpen.getState().open).toBe(false)
    expect(localStorage.getItem(NEW_TAB_MACHINE_KEY)).toBeNull()
  })

  it('Enter, Enter opens on the current machine and remembers it', async () => {
    machineStep.value = TWO
    openPicker()
    enter()
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Local Macfeat · this workspaceCurrent',
      'Second Macfeat · same branch'
    ])
    enter()
    await nextFrame()
    expect(launches).toEqual([
      expect.objectContaining({ agent: 'codex', worktreeId: 'wt-1', beforeSurfaceOpen: undefined })
    ])
    expect(readLastNewTabMachine(PROJECT)).toBe('local')
  })

  it('starts on the machine last picked for the project', async () => {
    machineStep.value = TWO
    rememberNewTabMachine(PROJECT, 'runtime:env-b')
    detections['repo-b::/b/feat'] = ['codex']
    openPicker()
    enter()
    expect(selected()).toContain('Second Mac')
    enter()
    await nextFrame()
    expect(launches).toEqual([
      expect.objectContaining({
        agent: 'codex',
        worktreeId: 'repo-b::/b/feat',
        beforeSurfaceOpen: expect.any(Function)
      })
    ])
  })

  it.each([
    {
      name: 'the remembered machine',
      step: TWO,
      remembered: 'runtime:env-b' as const,
      highlighted: 'Second Mac',
      worktreeId: 'repo-b::/b/feat',
      beforeSurfaceOpen: expect.any(Function)
    },
    {
      name: 'the current machine',
      step: ON_SECOND_MAC,
      remembered: null,
      highlighted: 'Second Mac',
      worktreeId: 'wt-1',
      beforeSurfaceOpen: undefined
    }
  ])(
    'after an agent search, step 2 still starts on $name',
    async ({ step, remembered, highlighted, worktreeId, beforeSurfaceOpen }) => {
      machineStep.value = step
      if (remembered) {
        rememberNewTabMachine(PROJECT, remembered)
      }
      openPicker()
      type('cod')
      enter()
      expect(selected()).toContain(highlighted)
      enter()
      await nextFrame()
      expect(launches).toEqual([
        expect.objectContaining({ agent: 'codex', worktreeId, beforeSurfaceOpen })
      ])
    }
  )

  const pointAt = (label: RegExp) => (): boolean =>
    fireEvent.pointerMove(screen.getByRole('option', { name: label }))
  it.each([
    {
      name: 'keeps the remembered machine while it still matches',
      step: TWO,
      remembered: 'runtime:env-b' as const,
      typed: 'mac',
      worktreeId: 'repo-b::/b/feat'
    },
    {
      name: 'keeps the current machine while it still matches',
      step: ON_SECOND_MAC,
      remembered: null,
      typed: 'mac',
      worktreeId: 'wt-1'
    },
    {
      name: 'moves to the first enabled match once the remembered machine is filtered out',
      step: TWO,
      remembered: 'runtime:env-b' as const,
      typed: 'local',
      worktreeId: 'wt-1'
    },
    {
      name: 'follows an arrow key after the search',
      step: TWO,
      remembered: 'runtime:env-b' as const,
      typed: 'mac',
      move: (): void => arrowDown(1),
      worktreeId: 'wt-1'
    },
    {
      name: 'follows the pointer after the search',
      step: TWO,
      remembered: 'runtime:env-b' as const,
      typed: 'mac',
      move: pointAt(/Local Mac/),
      worktreeId: 'wt-1'
    }
  ])('a machine search $name', async ({ step, remembered, typed, move, worktreeId }) => {
    machineStep.value = step
    detections['repo-b::/b/feat'] = ['codex']
    detections['repo-a::/a/feat'] = ['codex']
    if (remembered) {
      rememberNewTabMachine(PROJECT, remembered)
    }
    openPicker()
    enter()
    type(typed)
    await nextFrame()
    move?.()
    enter()
    await nextFrame()
    expect(launches).toEqual([expect.objectContaining({ agent: 'codex', worktreeId })])
  })

  it('disables a machine without the agent and starts on the current one', () => {
    machineStep.value = TWO
    rememberNewTabMachine(PROJECT, 'runtime:env-b')
    detections['repo-b::/b/feat'] = ['claude']
    openPicker()
    enter()
    expect(screen.getByRole('option', { name: /Second Mac/ }).getAttribute('aria-disabled')).toBe(
      'true'
    )
    expect(screen.getByText('Codex not found here')).toBeTruthy()
    expect(selected()).toContain('Local Mac')
  })

  it('moves the highlight off a machine whose agent check comes back without the agent', async () => {
    machineStep.value = TWO
    rememberNewTabMachine(PROJECT, 'runtime:env-b')
    openPicker()
    enter()
    expect(selected()).toContain('Second Mac')
    act(() => {
      detections['repo-b::/b/feat'] = ['claude']
      useAppStore.setState({})
    })
    expect(selected()).toContain('Local Mac')
    enter()
    await nextFrame()
    expect(launches).toEqual([
      expect.objectContaining({ worktreeId: 'wt-1', beforeSurfaceOpen: undefined })
    ])
  })

  it('drops a machine that goes offline while step 2 is open', () => {
    machineStep.value = { projectId: PROJECT, targets: [here, there, box] }
    const { rerender } = openPicker()
    enter()
    machineStep.value = { projectId: PROJECT, targets: [here, box] }
    rerender()
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Local Macfeat · this workspaceCurrent',
      'Build Boxfeat · same branch'
    ])
  })

  it.each([
    { name: 'a machine pick', close: (): boolean => enter() },
    {
      name: 'a close from step 2',
      close: (): void => act(() => useNewTabAgentPickerOpen.setState({ open: false }))
    }
  ])('after $name, an Esc elsewhere in the app is left alone', async ({ close }) => {
    machineStep.value = TWO
    openPicker()
    enter()
    close()
    await nextFrame()
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.body.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(false)
  })

  it('moves focus to the new search box on each step change', () => {
    machineStep.value = TWO
    openPicker()
    enter()
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Open Codex on...'))
    fireEvent.keyDown(searchBox(), { key: 'Escape' })
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Open a new tab with...'))
  })

  it.each([
    { agentMoves: 0, machineMoves: 0, machineSearch: '', agent: 'CodexDefault' },
    { agentMoves: 1, machineMoves: 1, machineSearch: '', agent: 'Claude' },
    { agentMoves: 1, machineMoves: 0, machineSearch: 'mac', agent: 'Claude' }
  ])(
    'Esc after searching "$machineSearch" on the machine step goes back to $agent, dialog open',
    ({ agentMoves, machineMoves, machineSearch, agent }) => {
      machineStep.value = TWO
      openPicker()
      arrowDown(agentMoves)
      enter()
      arrowDown(machineMoves)
      type(machineSearch)
      fireEvent.keyDown(searchBox(), { key: 'Escape' })
      expect(useNewTabAgentPickerOpen.getState().open).toBe(true)
      expect(screen.getByPlaceholderText('Open a new tab with...')).toBeTruthy()
      expect(selected()).toBe(agent)
    }
  )
})
