// @vitest-environment happy-dom
import { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../../shared/constants'
import { useAppStore } from '@/store'
import { registerPilotStore } from '../store'
import { NewTabAgentPicker } from './NewTabAgentPicker'
import {
  openNewTabAgentPickerOr,
  useNewTabAgentPickerOpen
} from './new-tab-agent-picker-open-state'

const launches = vi.hoisted((): unknown[] => [])
vi.mock('@/hooks/useDetectedAgents', () => ({
  useDetectedAgents: () => ({ detectedIds: ['claude', 'codex'], isLoading: false })
}))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: (args: unknown) => {
    launches.push(args)
    return { surface: { kind: 'host-published' } }
  }
}))

afterEach(() => {
  cleanup()
  act(() => useNewTabAgentPickerOpen.setState({ open: false }))
  registerPilotStore(null)
  launches.length = 0
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
    { typed: 'terminal', launches: [], bareTerminals: 1 }
  ])('Enter after typing "$typed" opens the selected row and closes', async (row) => {
    const { handleNewTab, input } = openPicker()
    fireEvent.change(input, { target: { value: row.typed } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    expect(launches).toEqual(row.launches.map((launch) => expect.objectContaining(launch)))
    expect(handleNewTab).toHaveBeenCalledTimes(row.bareTerminals)
    expect(useNewTabAgentPickerOpen.getState().open).toBe(false)
  })
})
