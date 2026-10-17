// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { LOCAL_NAMED, MINI, MINI_OFFLINE } from './__fixtures__/hosts'
import { HostsNotice } from './HostsNotice'
import { MachineChip } from './MachineChip'
import { PilotHostProvider, usePilotHost } from './PilotHostContext'
import { LOCAL_PILOT_HOST } from './pilot-host'
import { resetPilotHostsFeed, setPilotHostsForTests } from './pilot-hosts-feed'

afterEach(() => {
  cleanup()
  resetPilotHostsFeed()
})

function HostName(): React.JSX.Element {
  return <span>{usePilotHost().machineName}</span>
}

describe('MachineChip', () => {
  it('shows the machine only when the window has more than one Pilot host', () => {
    setPilotHostsForTests([LOCAL_NAMED])
    const { container, rerender } = render(<MachineChip host={MINI} />)
    expect(container.innerHTML).toBe('')

    setPilotHostsForTests([LOCAL_NAMED, MINI])
    rerender(<MachineChip host={MINI} />)
    expect(screen.getByText('Mac mini')).toBeTruthy()
  })
})

describe('HostsNotice', () => {
  it('renders one line per problem and nothing when all is well', () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI_OFFLINE])
    render(<HostsNotice reads={[]} what="cards" />)
    expect(screen.getByText("Mac mini can't be reached: its cards aren't shown here.")).toBeTruthy()
    cleanup()
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    const { container } = render(<HostsNotice reads={[]} what="cards" />)
    expect(container.innerHTML).toBe('')
  })
})

describe('usePilotHost', () => {
  it('is the local host outside a provider and the given host inside one', () => {
    render(<HostName />)
    expect(screen.getByText(LOCAL_PILOT_HOST.machineName)).toBeTruthy()
    cleanup()
    render(
      <PilotHostProvider host={MINI}>
        <HostName />
      </PilotHostProvider>
    )
    expect(screen.getByText('Mac mini')).toBeTruthy()
  })
})
