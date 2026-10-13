// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutomationListPayload, AutomationSummary, TickRow } from '../../shared/api-types'
import { AutomationsTable } from './AutomationsTable'
import { summary } from './fixtures'

const NOW = Date.UTC(2026, 9, 13, 18, 0)
const tick = (automationId: string, minutesAgo: number, counts: TickRow['counts']): TickRow => ({
  id: minutesAgo,
  automationId,
  startedAt: NOW - minutesAgo * 60_000,
  finishedAt: NOW - minutesAgo * 60_000 + 1000,
  dryRun: true,
  status: 'ok',
  error: null,
  counts
})
const STAGE_1: AutomationSummary = {
  ...summary,
  id: 'dev-e2e-fix',
  name: '13 · Fix red hourly e2e on dev',
  enabled: false,
  schedule: '5,35 * * * *',
  itemKind: 'Pipelines',
  lastTick: tick('dev-e2e-fix', 3, { notdue: 1 }),
  job: {
    id: '13',
    name: 'Fix red hourly e2e on dev',
    stage: 1,
    label: 'Open or update the ticket',
    feeds: ['dev-e2e-fix-start'],
    handsOver: 'the tickets it opens'
  }
}
const STAGE_2: AutomationSummary = {
  ...summary,
  id: 'dev-e2e-fix-start',
  name: '13 · Start fix sessions for red e2e tickets',
  enabled: true,
  schedule: '6,36 * * * *',
  itemKind: 'Linear tickets',
  lastTick: tick('dev-e2e-fix-start', 2, {}),
  job: {
    id: '13',
    name: null,
    stage: 2,
    label: 'Start a fix session per ticket',
    feeds: [],
    handsOver: null
  }
}
const SOLO: AutomationSummary = { ...summary, id: 'docker-prune', name: '07 · Clean Docker' }
const payload = (automations: AutomationSummary[]): AutomationListPayload => ({
  automations,
  errors: [],
  peopleError: null,
  missingDirs: []
})

function renderTable(automations: AutomationSummary[]) {
  const onOpen = vi.fn()
  const onOpenJob = vi.fn()
  render(
    <AutomationsTable
      payload={payload(automations)}
      now={NOW}
      onOpen={onOpen}
      onOpenJob={onOpenJob}
    />
  )
  return { onOpen, onOpenJob }
}

describe('AutomationsTable: a job of several automations', () => {
  afterEach(cleanup)

  it('shows 13 as one row with a stages chip, then its stages indented in stage order', () => {
    renderTable([SOLO, STAGE_2, STAGE_1])
    const rows = screen.getAllByRole('button')
    expect(rows.map((r) => r.getAttribute('aria-label') ?? r.textContent)).toEqual([
      expect.stringContaining('07 · Clean Docker'),
      'Job 13 · Fix red hourly e2e on dev, 2 stages',
      'Stage 1 Open or update the ticket',
      'Stage 2 Start a fix session per ticket'
    ])
    const job = within(rows[1])
    expect(job.getByText('2 stages')).toBeTruthy()
    expect(job.getByText('Pipelines → Linear tickets')).toBeTruthy()
    // combined: on because stage 2 is; the newest tick is stage 2's
    expect(job.getByText('Enabled')).toBeTruthy()
    expect(job.getByText('2 min ago · dry run · 0 checked')).toBeTruthy()
    const first = within(rows[2])
    expect(first.getByText('5,35 * * * *')).toBeTruthy()
    expect(first.getByText('3 min ago · dry run · 1 checked · 1 not due')).toBeTruthy()
    expect(first.getByText('Paused')).toBeTruthy()
    expect(within(rows[3]).getByText('Linear tickets')).toBeTruthy()
  })

  it('opens the job page from the job row, and a stage’s own page from its row', () => {
    const { onOpen, onOpenJob } = renderTable([STAGE_1, STAGE_2])
    fireEvent.click(
      screen.getByRole('button', { name: 'Job 13 · Fix red hourly e2e on dev, 2 stages' })
    )
    expect(onOpenJob).toHaveBeenCalledWith('13')
    fireEvent.click(screen.getByRole('button', { name: 'Stage 2 Start a fix session per ticket' }))
    expect(onOpen).toHaveBeenCalledWith('dev-e2e-fix-start')
  })

  it('keeps an automation without a job one plain row', () => {
    const { onOpen } = renderTable([SOLO])
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByText(/stages?$/)).toBeNull()
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledWith('docker-prune')
  })
})
