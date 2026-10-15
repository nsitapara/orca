// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { summary } from './fixtures'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { resetAutomationsFeed } from '../run-views/automations-feed'
import { ActivityPage } from './ActivityPage'
import { showActivity } from './automations-view'

function serveEmpty(): void {
  pilotRpc.mockImplementation(async (method: string) =>
    method === 'pilot.automations.list'
      ? { automations: [summary], errors: [], peopleError: null, missingDirs: [] }
      : { live: [], ticks: [], loose: [], reach: null }
  )
}

const activityCalls = () =>
  pilotRpc.mock.calls.filter((c) => c[0] === 'pilot.activity.list').map((c) => c[1])

describe('ActivityPage', () => {
  afterEach(() => {
    cleanup()
    resetAutomationsFeed()
    pilotRpc.mockReset()
  })

  it("starts with the filter it was opened with, over the last week, and changes it with each automation's chip", async () => {
    pilotRpc.mockImplementation(async (method: string) =>
      method === 'pilot.automations.list'
        ? { automations: [summary], errors: [], peopleError: null, missingDirs: [] }
        : { live: [], ticks: [], loose: [], reach: null }
    )
    showActivity(['fix-ci'])
    render(<ActivityPage />)
    await waitFor(() =>
      expect(activityCalls()[0]).toMatchObject({ automationIds: ['fix-ci'], limit: 300 })
    )
    expect(typeof activityCalls()[0].since).toBe('number')
    fireEvent.click(await screen.findByRole('button', { name: 'Fix failed CI' }))
    await waitFor(() => expect(activityCalls().at(-1)).toMatchObject({ automationIds: undefined }))
  })

  it('applies a filter requested while the page is already open', async () => {
    serveEmpty()
    render(<ActivityPage />)
    await waitFor(() => expect(activityCalls().length).toBeGreaterThan(0))
    act(() => showActivity(['fix-ci']))
    await waitFor(() => expect(activityCalls().at(-1)).toMatchObject({ automationIds: ['fix-ci'] }))
  })
})
