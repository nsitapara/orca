// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const orcaPage = vi.fn()
vi.mock('../../../../../renderer/src/components/automations/AutomationsPage', () => ({
  default: (props: unknown) => {
    orcaPage(props)
    return <div>orca-page</div>
  }
}))
vi.mock('./PilotAutomationsTab', () => ({ PilotAutomationsTab: () => <div>pilot-tab</div> }))

import PilotAutomationsPage, { AUTOMATIONS_TAB_KEY } from './PilotAutomationsPage'

describe('PilotAutomationsPage tabs', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    orcaPage.mockReset()
    vi.restoreAllMocks()
  })

  it('defaults to Pilot and switches tabs, remembering the choice', async () => {
    render(<PilotAutomationsPage />)
    expect(screen.getByText('pilot-tab')).toBeTruthy()
    expect(screen.queryByText('orca-page')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Orca' }))
    expect(await screen.findByText('orca-page')).toBeTruthy()
    expect(screen.getByText("Orca's own automations, run by Orca's engine inside Pilot.")).toBeTruthy()
    expect(window.localStorage.getItem(AUTOMATIONS_TAB_KEY)).toBe('orca')
    fireEvent.click(screen.getByRole('tab', { name: 'Pilot' }))
    expect(screen.getByText('pilot-tab')).toBeTruthy()
  })

  it('renders upstream AutomationsPage with the props AppWorkspaceShell gave it (none)', async () => {
    render(<PilotAutomationsPage />)
    fireEvent.click(screen.getByRole('tab', { name: 'Orca' }))
    expect(orcaPage).toHaveBeenCalledWith({})
  })

  it('restores the remembered tab', async () => {
    window.localStorage.setItem(AUTOMATIONS_TAB_KEY, 'orca')
    render(<PilotAutomationsPage />)
    expect(await screen.findByText('orca-page')).toBeTruthy()
  })

  it('falls back to Pilot when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render(<PilotAutomationsPage />)
    expect(screen.getByText('pilot-tab')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Orca' }))
    expect(await screen.findByText('orca-page')).toBeTruthy()
  })
})
