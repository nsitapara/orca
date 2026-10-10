// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PilotStatus } from '../../shared/api-types'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import PilotAutomationsPage from './PilotAutomationsPage'

const status: PilotStatus = {
  version: '0.1.0',
  process: 'main',
  dataPath: '/tmp/pilot',
  automationDirs: ['/a', '/b'],
  missingDirs: ['/b']
}

describe('PilotAutomationsPage', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })

  it('shows version, process, folders and missing folders', async () => {
    pilotRpc.mockResolvedValue(status)
    render(<PilotAutomationsPage />)
    expect(await screen.findByText('Pilot 0.1.0 · main')).toBeTruthy()
    expect(screen.getByText('Automation folders: /a, /b')).toBeTruthy()
    expect(screen.getByText('Missing: /b')).toBeTruthy()
    expect(pilotRpc).toHaveBeenCalledWith('pilot.status')
  })

  it('omits the Missing line when nothing is missing', async () => {
    pilotRpc.mockResolvedValue({ ...status, missingDirs: [] })
    render(<PilotAutomationsPage />)
    await screen.findByText('Pilot 0.1.0 · main')
    expect(screen.queryByText(/^Missing:/)).toBeNull()
  })

  it("shows an error when Pilot isn't responding", async () => {
    pilotRpc.mockRejectedValue(new Error('boom'))
    render(<PilotAutomationsPage />)
    expect(await screen.findByText(/Pilot isn't responding: Error: boom/)).toBeTruthy()
  })
})
