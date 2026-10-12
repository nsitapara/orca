// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { timelineRun } from './timeline.fixtures'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { StepList } from './StepList'

describe('StepList', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
  })

  it('shows each step: agent or shell, mode, status, cost, exit code and outputs', () => {
    render(<StepList runId="r1" steps={timelineRun().steps} />)
    expect(screen.getByText('1. fix')).toBeTruthy()
    expect(screen.getByText('Claude · mode fix · Done · $1.20')).toBeTruthy()
    expect(screen.getByText('Outputs: found_bugs=3')).toBeTruthy()
    expect(screen.getByText('Shell · Skipped · exit 3')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /resume/i })).toHaveLength(1)
  })

  it.each([
    ['opened', 'Opened in a new tab'],
    ['focused', 'Switched to its tab']
  ])("resumes the step's session (%s) and says what happened", async (action, note) => {
    pilotRpc.mockResolvedValue({ action, handle: 'term_9' })
    render(<StepList runId="r1" steps={timelineRun().steps} />)
    fireEvent.click(screen.getByRole('button', { name: /resume/i }))
    expect(await screen.findByText(note)).toBeTruthy()
    expect(pilotRpc).toHaveBeenCalledWith('pilot.session.resume', { runId: 'r1', stepIdx: 0 })
  })

  it('shows why a resume failed', async () => {
    pilotRpc.mockRejectedValue(new Error('Run r1 has no worktree to resume in'))
    render(<StepList runId="r1" steps={timelineRun().steps} />)
    fireEvent.click(screen.getByRole('button', { name: /resume/i }))
    expect(await screen.findByText('Run r1 has no worktree to resume in')).toBeTruthy()
  })
})
