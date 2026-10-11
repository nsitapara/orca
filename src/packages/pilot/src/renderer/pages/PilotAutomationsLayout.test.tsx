// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const orcaPage = vi.fn()
let orcaThrows = false
vi.mock('../../../../../renderer/src/components/automations/AutomationsPage', () => ({
  default: (props: unknown) => {
    if (orcaThrows) {
      throw new Error('boom')
    }
    orcaPage(props)
    return <div>orca-page</div>
  }
}))
vi.mock('./PilotAutomationsSection', () => ({
  PilotAutomationsSection: () => <div>yaml-section</div>
}))

import PilotAutomationsPage from './PilotAutomationsPage'

describe('PilotAutomationsPage layout', () => {
  afterEach(() => {
    cleanup()
    orcaPage.mockReset()
    orcaThrows = false
    vi.restoreAllMocks()
  })

  it("shows Orca's automations and the YAML ones on one page, with no tabs", async () => {
    render(<PilotAutomationsPage />)
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(await screen.findByText('orca-page')).toBeTruthy()
    expect(screen.getByText('yaml-section')).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
  })

  it('renders upstream AutomationsPage with the props AppWorkspaceShell gave it (none)', async () => {
    render(<PilotAutomationsPage />)
    await screen.findByText('orca-page')
    expect(orcaPage).toHaveBeenCalledWith({})
  })

  it('contains an Orca page crash, keeps the YAML section, and retries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    orcaThrows = true
    render(<PilotAutomationsPage />)
    expect(await screen.findByText("Orca's Automations page couldn't load.")).toBeTruthy()
    expect(screen.getByText('yaml-section')).toBeTruthy()
    orcaThrows = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('orca-page')).toBeTruthy()
  })
})
