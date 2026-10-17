// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutomationListPayload, AutomationSummary } from '../../shared/api-types'
import { byHost, LOCAL_NAMED, MINI, MINI_OFFLINE } from '../hosts/__fixtures__/hosts'
import { resetPilotHostsFeed, setPilotHostsForTests } from '../hosts/pilot-hosts-feed'
import { summary } from '../pages/fixtures'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { AUTOMATIONS_POLL_MS, resetAutomationsFeed, useAutomationsFeed } from './automations-feed'

const list = (automations: AutomationSummary[]): AutomationListPayload => ({
  automations,
  errors: [],
  peopleError: null,
  missingDirs: []
})

function Names(): React.JSX.Element {
  const { list, byId } = useAutomationsFeed()
  return (
    <p>{list.length ? `${list.map((a) => a.id).join(',')}:${byId.get('fix-ci')?.name}` : 'none'}</p>
  )
}

describe('useAutomationsFeed', () => {
  afterEach(() => {
    cleanup()
    resetAutomationsFeed()
    resetPilotHostsFeed()
    pilotRpc.mockReset()
    vi.useRealTimers()
  })

  it('loads the list once for every reader on screen', async () => {
    pilotRpc.mockResolvedValue({
      automations: [summary],
      errors: [],
      peopleError: null,
      missingDirs: []
    })
    render(
      <>
        <Names />
        <Names />
      </>
    )
    expect(await screen.findAllByText('fix-ci:Fix failed CI')).toHaveLength(2)
    expect(pilotRpc).toHaveBeenCalledTimes(1)
  })

  it("keeps each machine's last list through a failed read, and never an unreachable machine's", async () => {
    vi.useFakeTimers()
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    let miniDown = false
    pilotRpc.mockImplementation(
      byHost({
        local: () => list([summary]),
        mini: () => {
          if (miniDown) {
            throw new Error('timed out')
          }
          return list([{ ...summary, id: 'mini-only' }])
        }
      })
    )
    render(<Names />)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByText('fix-ci,mini-only:Fix failed CI')).toBeTruthy()

    miniDown = true
    await act(() => vi.advanceTimersByTimeAsync(AUTOMATIONS_POLL_MS))
    expect(pilotRpc).toHaveBeenCalledTimes(4)
    expect(screen.getByText('fix-ci,mini-only:Fix failed CI')).toBeTruthy()

    act(() => setPilotHostsForTests([LOCAL_NAMED, MINI_OFFLINE]))
    expect(screen.getByText('fix-ci:Fix failed CI')).toBeTruthy()
  })
})
