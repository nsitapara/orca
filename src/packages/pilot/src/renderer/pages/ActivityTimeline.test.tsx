// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActivityTick } from '../../shared/api-types'
import { ActivityTimeline } from './ActivityTimeline'

const tick: ActivityTick = {
  id: 7,
  automationId: 'ci',
  startedAt: Date.UTC(2026, 9, 10, 19, 10),
  finishedAt: Date.UTC(2026, 9, 10, 19, 10, 9),
  dryRun: false,
  status: 'ok',
  error: null,
  counts: { started: 1, skipped: 1 },
  items: [
    {
      tickId: 7,
      itemKey: '!1561',
      label: '!1561 web-1493',
      verdict: 'started',
      reason: 'All checks pass',
      checks: [{ check: 'Clean', ok: true, reason: 'No uncommitted changes' }],
      fields: {},
      runId: 'ci-1'
    },
    {
      tickId: 7,
      itemKey: '!1574',
      label: '!1574 web-1474',
      verdict: 'skipped',
      reason: '2 uncommitted files',
      checks: [{ check: 'Clean', ok: false, reason: '2 uncommitted files' }],
      fields: {},
      runId: null
    }
  ],
  runs: [
    {
      id: 'ci-1',
      automationId: 'ci',
      tickId: 7,
      itemKey: '!1561',
      itemLabel: '!1561 web-1493',
      worktreePath: '/wt',
      status: 'running',
      outcome: null,
      startedAt: 1,
      finishedAt: null,
      costUsd: 0.84,
      tokens: 1,
      worktreeId: null,
      trigger: 'schedule' as const,
      parentRunId: null,
      imported: false,
      steps: []
    }
  ]
}

describe('ActivityTimeline', () => {
  it('names the v2 run statuses', () => {
    render(
      <ActivityTimeline
        ticks={[{ ...tick, runs: [{ ...tick.runs[0], status: 'needs_you' }] }]}
        checkNames={[]}
      />
    )
    expect(screen.getByText('Run ci-1 · !1561 web-1493 · Needs you · $0.84')).toBeTruthy()
  })

  afterEach(cleanup)

  it.each([
    ['asking', 'Asking first'],
    ['running', 'Running'],
    ['done', 'Done'],
    ['failed', 'Failed'],
    ['timed_out', 'Timed out'],
    ['cancelled', 'Cancelled']
  ] as const)('keeps the visible label of a %s run: %s', (status, label) => {
    render(
      <ActivityTimeline
        ticks={[{ ...tick, runs: [{ ...tick.runs[0], status }] }]}
        checkNames={[]}
      />
    )
    expect(screen.getByText(`Run ci-1 · !1561 web-1493 · ${label} · $0.84`)).toBeTruthy()
  })

  it('shows each tick with its runs, and its check table on demand', () => {
    render(<ActivityTimeline ticks={[tick]} checkNames={['Clean']} />)
    expect(screen.getByText('2 checked · 1 started · 1 skipped')).toBeTruthy()
    expect(screen.getByText(/ci-1/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /why: 2 items checked/i }))
    expect(screen.getByText('2 uncommitted files', { selector: 'td,div,span' })).toBeTruthy()
  })

  it('marks dry runs, shows run outcome and cost, and the empty state', () => {
    const failedRun = {
      ...tick.runs[0],
      id: 'ci-2',
      status: 'failed' as const,
      outcome: "Couldn't start: no repo"
    }
    render(
      <ActivityTimeline
        ticks={[
          { ...tick, id: 8, dryRun: true },
          { ...tick, id: 6, runs: [failedRun] }
        ]}
        checkNames={[]}
      />
    )
    expect(screen.getByText('Dry run')).toBeTruthy()
    expect(screen.getByText('Run ci-1 · !1561 web-1493 · Running · $0.84')).toBeTruthy()
    expect(screen.getByText(/Couldn't start: no repo/)).toBeTruthy()
    cleanup()
    render(<ActivityTimeline ticks={[]} checkNames={[]} />)
    expect(screen.getByText('No ticks yet.')).toBeTruthy()
  })
})
