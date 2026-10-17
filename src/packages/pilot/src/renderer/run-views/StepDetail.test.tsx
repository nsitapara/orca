// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StepRow } from '../../shared/api-types'
import { testStepRow } from '../../shared/run-views/__fixtures__/runs'
import { stepRow, timelineRun } from '../timeline/timeline.fixtures'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

const refreshWorktreeTimeline = vi.fn()
vi.mock('../sidebar/timeline-feed', () => ({
  refreshWorktreeTimeline: (...args: unknown[]) => refreshWorktreeTimeline(...args)
}))

// The log has its own RPC and test (StepLog.test.tsx); here it must not meet these tests' call counts.
vi.mock('./StepLog', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  StepLog: () => null
}))

import { StepDetail } from './StepDetail'

// The rail renders one StepDetail per step it expands; this stands in for it.
function Steps({
  steps = timelineRun().steps,
  ...rest
}: {
  runId: string
  worktreePath?: string
  checkoutRemoved?: boolean
  steps?: StepRow[]
}): React.JSX.Element {
  return (
    <>
      {steps.map((step) => (
        <StepDetail key={step.idx} {...rest} step={step} />
      ))}
    </>
  )
}

describe('StepDetail', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
    refreshWorktreeTimeline.mockReset()
    vi.unstubAllGlobals()
  })

  it.each([
    ['the desktop', false, 1],
    ['the browser version', true, 0]
  ])(
    'shows each step on %s: agent or shell, mode, status, cost, exit code and outputs',
    (_where, browser, resumes) => {
      vi.stubGlobal('__ORCA_WEB_CLIENT__', browser)
      render(<Steps runId="r1" />)
      expect(screen.getByText('Claude · mode fix · Done · $1.20')).toBeTruthy()
      expect(screen.getByText('Outputs: found_bugs=3')).toBeTruthy()
      expect(screen.getByText('Shell · Skipped · exit 3')).toBeTruthy()
      expect(screen.queryAllByRole('button', { name: /resume/i })).toHaveLength(resumes)
    }
  )

  it.each([
    ['opened', 'Opened in a new tab'],
    ['focused', 'Switched to its tab']
  ])("resumes the step's session (%s) and says what happened", async (action, note) => {
    pilotRpc.mockResolvedValue({ action, handle: 'term_9' })
    render(<Steps runId="r1" />)
    fireEvent.click(screen.getByRole('button', { name: /resume/i }))
    expect(await screen.findByText(note)).toBeTruthy()
    expect(pilotRpc).toHaveBeenCalledWith('pilot.session.resume', { runId: 'r1', stepIdx: 0 })
  })

  it('shows why a resume failed', async () => {
    pilotRpc.mockRejectedValue(new Error('Run r1 has no worktree to resume in'))
    render(<Steps runId="r1" />)
    fireEvent.click(screen.getByRole('button', { name: /resume/i }))
    expect(await screen.findByText('Run r1 has no worktree to resume in')).toBeTruthy()
  })

  it('disables Resume while its call is in flight, so a double click opens one tab', async () => {
    let finish: (v: unknown) => void = () => {}
    pilotRpc.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    render(<Steps runId="r1" />)
    const button = screen.getByRole('button', { name: /resume/i })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(pilotRpc).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /resume/i }).hasAttribute('disabled')).toBe(true)
    )
    finish({ action: 'opened', handle: 'term_9' })
    expect(await screen.findByText('Opened in a new tab')).toBeTruthy()
    expect(screen.getByRole('button', { name: /resume/i }).hasAttribute('disabled')).toBe(false)
  })

  it("refreshes the worktree's timeline after a successful resume only", async () => {
    pilotRpc.mockResolvedValueOnce({ action: 'opened', handle: 'term_9' })
    render(<Steps runId="r1" worktreePath="/wt/a" />)
    fireEvent.click(screen.getByRole('button', { name: /resume/i }))
    await screen.findByText('Opened in a new tab')
    expect(refreshWorktreeTimeline).toHaveBeenCalledWith('/wt/a')
    refreshWorktreeTimeline.mockReset()
    pilotRpc.mockRejectedValueOnce(new Error('nope'))
    fireEvent.click(screen.getByRole('button', { name: /resume/i }))
    await screen.findByText('nope')
    expect(refreshWorktreeTimeline).not.toHaveBeenCalled()
  })

  it.each([
    ['the desktop', false, 1],
    ['the browser version', true, 0]
  ])('a removed checkout shows a note in place of Resume on %s', (_where, browser, notes) => {
    vi.stubGlobal('__ORCA_WEB_CLIENT__', browser)
    render(<Steps runId="r1" checkoutRemoved />)
    expect(screen.queryAllByText('Checkout removed')).toHaveLength(notes)
    expect(screen.queryByRole('button', { name: /resume/i })).toBeNull()
  })

  it.each([
    [
      'a stopped step',
      'stopped',
      'Shell · Stopped · exit 3',
      'pipeline 2934 is green',
      'text-muted-foreground'
    ],
    ['a failed step', 'failed', 'Shell · Failed · exit 3', 'Exited 3: boom', 'text-destructive']
  ] as const)(
    'shows %s with its reason, red only when it broke',
    (_n, status, facts, error, colour) => {
      const step = stepRow({
        agent: 'shell',
        kind: 'shell',
        mode: null,
        costUsd: null,
        sessionId: null,
        outputs: {},
        exitCode: 3,
        status,
        error
      })
      render(<StepDetail runId="r1" step={step} />)
      expect(screen.getByText(facts)).toBeTruthy()
      expect(screen.getByText(error).className).toContain(colour)
    }
  )

  const shellStep = (result: StepRow['result']) =>
    stepRow({
      name: 'context',
      agent: 'shell',
      kind: 'shell',
      mode: null,
      costUsd: null,
      sessionId: null,
      outputs: {},
      exitCode: 0,
      result
    })

  it("shows a step's pilotcli result: command, outcome and reason, and its data as JSON, folded", () => {
    render(
      <Steps
        runId="r1"
        steps={[
          shellStep({
            command: 'skills get-context',
            outcome: 'ok',
            reason: '2 failed jobs',
            data: { pipeline_id: 2934 },
            meta: {}
          })
        ]}
      />
    )
    expect(screen.getByText('pilotcli skills get-context · ok: 2 failed jobs')).toBeTruthy()
    expect(screen.getByText('Data').closest('details')?.hasAttribute('open')).toBe(false)
    expect(screen.queryByText(/"pipeline_id": 2934/)).toBeNull()
    const details = screen.getByText('Data').closest('details') as HTMLDetailsElement
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(screen.getByText(/"pipeline_id": 2934/).tagName).toBe('PRE')
  })

  it('says why a result’s data was not kept, with no viewer', () => {
    render(
      <Steps
        runId="r1"
        steps={[
          shellStep({
            command: 'skills get-context',
            outcome: 'ok',
            reason: '3 threads waiting',
            data_omitted: 'may contain comment or ticket text'
          })
        ]}
      />
    )
    expect(screen.getByText('Data not kept: may contain comment or ticket text')).toBeTruthy()
    expect(screen.queryByText('Data')).toBeNull()
  })

  it("shows a shell step's kept output", () => {
    render(
      <StepDetail
        runId="r1"
        step={testStepRow({
          agent: 'shell',
          kind: 'shell',
          sessionId: null,
          outputTail: 'pushed\n--- stderr ---\nwarn'
        })}
      />
    )
    expect(screen.getByLabelText('Output').textContent).toBe('pushed\n--- stderr ---\nwarn')
  })
})
