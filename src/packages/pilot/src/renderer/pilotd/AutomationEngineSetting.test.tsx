// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { getDefaultSettings } from '../../../../../shared/constants'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { registerPilotStore } from '../store'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { AutomationEngineSetting } from './AutomationEngineSetting'

function renderSetting(saved: Partial<GlobalSettings> = {}) {
  const updateSettings = vi.fn(async (_u: Partial<GlobalSettings>) => {})
  render(
    <AutomationEngineSetting
      settings={{ ...getDefaultSettings('/tmp'), ...saved }}
      updateSettings={updateSettings}
    />
  )
  return updateSettings
}

beforeEach(() => registerPilotStore(useAppStore))
afterEach(() => {
  cleanup()
  pilotRpc.mockReset()
  registerPilotStore(null)
})

describe('Settings › Automations › Automation engine', () => {
  it('starts on Built-in and saves a pick of pilotd', async () => {
    pilotRpc.mockResolvedValue({ reachable: true, engineRunning: true, build: '9a95182' })
    const updateSettings = renderSetting()
    expect(screen.getByRole('radio', { name: 'Built-in' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    fireEvent.click(screen.getByRole('radio', { name: 'pilotd' }))
    expect(updateSettings).toHaveBeenCalledWith({ pilotAutomationEngine: 'pilotd' })
    expect(
      await screen.findByText(
        'pilotd: reachable at http://127.0.0.1:8787 · engine running · build 9a95182'
      )
    ).toBeTruthy()
  })

  it('shows a saved pick, saves a new address, and says when pilotd is unreachable there', async () => {
    pilotRpc.mockResolvedValue({
      reachable: false,
      error: 'Nothing answers at http://127.0.0.1:9000.'
    })
    const updateSettings = renderSetting({
      pilotAutomationEngine: 'pilotd',
      pilotdAddress: 'http://127.0.0.1:9000'
    })
    expect(screen.getByRole('radio', { name: 'pilotd' }).getAttribute('aria-checked')).toBe('true')
    expect(
      await screen.findByText(
        'pilotd: not reachable at http://127.0.0.1:9000. Nothing answers at http://127.0.0.1:9000.'
      )
    ).toBeTruthy()
    expect(pilotRpc).toHaveBeenCalledWith(
      'pilot.pilotd.health',
      { address: 'http://127.0.0.1:9000' },
      expect.anything()
    )
    const field = screen.getByLabelText('pilotd address')
    fireEvent.change(field, { target: { value: ' http://127.0.0.1:8787 ' } })
    fireEvent.blur(field)
    expect(updateSettings).toHaveBeenCalledWith({ pilotdAddress: 'http://127.0.0.1:8787' })
  })
})
