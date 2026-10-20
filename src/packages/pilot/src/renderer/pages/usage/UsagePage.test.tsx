// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { createEmptyRateLimitState } from '../../../../../../shared/rate-limit-state-factory'
import type { ProviderRateLimits } from '../../../../../../shared/rate-limit-types'
import type { UsageDashboard } from '../../../shared/api-types'
import { closeRunPanel, openRunPanel } from '../../run-views/run-panel-state'
import {
  pilotAutomationsView,
  pilotOpenAutomation,
  setPilotAutomationsView,
  setPilotOpenAutomation
} from '../automations-view'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { UsagePage } from './UsagePage'

const HOUR = 3_600_000
// Codex's week began on Oct 20 at 02:21 local time and resets a week later.
const CODEX_RESET = new Date(2026, 9, 27, 2, 21).getTime()
const codexLimits: ProviderRateLimits = {
  provider: 'codex',
  session: {
    usedPercent: 3,
    windowMinutes: 300,
    resetsAt: Date.now() + HOUR,
    resetDescription: null
  },
  weekly: { usedPercent: 49, windowMinutes: 10080, resetsAt: CODEX_RESET, resetDescription: null },
  updatedAt: 1,
  error: null,
  status: 'ok'
}
const both = (claude: number, codex: number) => ({
  claude: { tokens: claude * 1e6, costUsd: claude },
  codex: { tokens: codex * 1e6, costUsd: codex }
})
const payload: UsageDashboard = {
  days: 7,
  sinceDay: '2026-10-14',
  total: { runs: 3, tokens: 165e6, costUsd: 165, byAgent: both(15, 150) },
  automations: [
    {
      automationId: 'ui-qa-overnight',
      name: '04 · Test branch UIs overnight',
      runs: 2,
      tokens: 120e6,
      costUsd: 120,
      byAgent: both(10, 110)
    },
    {
      automationId: 'merge-dev',
      name: '02 · Merge dev into my MR branches',
      runs: 1,
      tokens: 45e6,
      costUsd: 45,
      byAgent: both(5, 40)
    }
  ],
  daily: [
    { day: '2026-10-19', byAgent: both(5, 40) },
    { day: '2026-10-20', byAgent: both(10, 110) }
  ],
  topRuns: [
    {
      runId: 'ui-qa-1',
      automationId: 'ui-qa-overnight',
      name: '04 · Test branch UIs overnight',
      itemLabel: 'web-2292-trait-summary',
      startedAt: Date.now() - HOUR,
      status: 'done',
      tokens: 55e6,
      costUsd: 54.42,
      byAgent: both(0, 54.42)
    }
  ],
  sinceReset: {
    codex: {
      sinceDay: '2026-10-20',
      total: { tokens: 133e6, costUsd: 159.16 },
      automations: [
        {
          automationId: 'ui-qa-overnight',
          name: '04 · Test branch UIs overnight',
          tokens: 98.4e6,
          costUsd: 113.29
        },
        {
          automationId: 'merge-dev',
          name: '02 · Merge dev into my MR branches',
          tokens: 31.4e6,
          costUsd: 38.77
        }
      ]
    }
  },
  pendingSteps: 2,
  measuredAt: Date.now() - 60_000
}

describe('UsagePage', () => {
  beforeEach(() => {
    useAppStore.setState({
      rateLimits: { ...createEmptyRateLimitState(), codex: codexLimits },
      fetchRateLimits: async () => {}
    })
    pilotRpc.mockImplementation(async (method: string, params: { days: number }) => {
      if (method === 'pilot.usage.dashboard') {
        return { ...payload, days: params.days, daily: payload.daily.slice(-params.days) }
      }
      return null
    })
  })

  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
    closeRunPanel()
    setPilotOpenAutomation(null)
    setPilotAutomationsView('automations')
  })

  it("asks for the week of Codex's reset, and ranks what the automations spent since it under its limit", async () => {
    render(<UsagePage />)
    const codex = await screen.findByRole('region', { name: 'Codex limits' })
    expect(within(codex).getByText('49% used')).toBeTruthy()
    const since = await within(codex).findByRole('list', { name: 'Automations since the reset' })
    expect(
      within(since)
        .getAllByRole('listitem')
        .map((li) => li.textContent)
    ).toEqual([
      '04 · Test branch UIs overnight98.4M$113.2971%',
      '02 · Merge dev into my MR branches31.4M$38.7724%'
    ])
    expect(pilotRpc).toHaveBeenCalledWith('pilot.usage.dashboard', {
      days: 7,
      resetDays: { codex: '2026-10-20' }
    })
  })

  it("splits each automation's cost by agent; its name opens it and a costly run opens its run", async () => {
    render(<UsagePage />)
    const table = await screen.findByRole('table', { name: 'Usage by automation' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(
      rows.map((r) =>
        within(r)
          .getAllByRole('cell')
          .map((c) => c.textContent)
      )
    ).toEqual([
      [
        '04 · Test branch UIs overnight',
        '2',
        '$10.00 · 10.0M',
        '$110.00 · 110.0M',
        '$120.00',
        '73%'
      ],
      ['02 · Merge dev into my MR branches', '1', '$5.00 · 5.0M', '$40.00 · 40.0M', '$45.00', '27%']
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Open run' }))
    expect(openRunPanel()).toMatchObject({ runId: 'ui-qa-1' })
    fireEvent.click(
      within(rows[1]).getByRole('button', { name: '02 · Merge dev into my MR branches' })
    )
    expect(pilotAutomationsView()).toBe('automations')
    expect(pilotOpenAutomation()).toBe('merge-dev')
  })

  it('reads the period picked; a single day has no chart by day', async () => {
    render(<UsagePage />)
    expect(await screen.findByRole('list', { name: 'Cost by day' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Today' }))
    await waitFor(() =>
      expect(pilotRpc).toHaveBeenLastCalledWith('pilot.usage.dashboard', {
        days: 1,
        resetDays: { codex: '2026-10-20' }
      })
    )
    await screen.findByText('Cost · Today')
    expect(screen.queryByRole('list', { name: 'Cost by day' })).toBeNull()
  })
})
