// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutomationListPayload, PilotStatus } from '../../shared/api-types'
import { detail, summary } from './fixtures'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import PilotAutomationsPage from './PilotAutomationsPage'

const status: PilotStatus = {
  version: '0.1.0',
  process: 'main',
  dataPath: '/tmp/pilot',
  automationDirs: ['/a'],
  missingDirs: [],
  peopleError: null,
  error: null,
  loopStartedAt: null,
  lastLoopFinishedAt: null
}
const list: AutomationListPayload = {
  automations: [summary],
  errors: [],
  peopleError: null,
  missingDirs: []
}

function serve(payload: AutomationListPayload): void {
  pilotRpc.mockImplementation(async (method: string) => {
    if (method === 'pilot.automations.list') {
      return payload
    }
    if (method === 'pilot.automations.get') {
      return detail
    }
    if (method === 'pilot.automations.activity') {
      return []
    }
    return status
  })
}

describe('PilotAutomationsPage', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })

  it('lists automations and opens one', async () => {
    serve(list)
    render(<PilotAutomationsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Fix failed CI/ }))
    expect(await screen.findByText('No ticks yet.')).toBeTruthy()
  })

  it('shows bad files, a people notice and missing folders above the table', async () => {
    serve({
      automations: [summary],
      errors: [{ file: '/a/bad.yaml', errors: ['schedule is required'] }],
      peopleError: 'people.yaml and people.yml both exist',
      missingDirs: ['/gone']
    })
    render(<PilotAutomationsPage />)
    expect(await screen.findByText('/a/bad.yaml: schedule is required')).toBeTruthy()
    expect(screen.queryByText(/bad\.yaml: \/a\/bad\.yaml/)).toBeNull()
    expect(screen.getByText('People: people.yaml and people.yml both exist')).toBeTruthy()
    expect(screen.getByText('Folder not found: /gone')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Fix failed CI/ })).toBeTruthy()
  })

  it('says so when there are no automations', async () => {
    serve({ ...list, automations: [] })
    render(<PilotAutomationsPage />)
    expect(await screen.findByText('No automations found.')).toBeTruthy()
  })

  it("degraded: shows the list error and why Pilot couldn't start", async () => {
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.status') {
        return { ...status, error: 'database is locked' }
      }
      throw new Error("Pilot isn't running: database is locked")
    })
    render(<PilotAutomationsPage />)
    expect(await screen.findByText("Pilot isn't running: database is locked")).toBeTruthy()
    expect(await screen.findByText("Pilot couldn't start: database is locked")).toBeTruthy()
  })

  it('degraded without a status error still shows the list error', async () => {
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.status') {
        return status
      }
      throw new Error('timed out')
    })
    render(<PilotAutomationsPage />)
    expect(await screen.findByText('timed out')).toBeTruthy()
    expect(screen.queryByText(/couldn't start/)).toBeNull()
  })
})
