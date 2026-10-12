// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inboxItem, timelineRun } from './fixtures'

vi.mock('../api', () => ({ pilotRpc: vi.fn() }))

import { RunCard } from './RunCard'

describe('RunCard', () => {
  afterEach(cleanup)

  it('shows status, cost, title and outcome; the steps open on demand', () => {
    render(
      <ul>
        <RunCard run={timelineRun()} title="Fix failed CI on my MRs" />
      </ul>
    )
    expect(screen.getByText('Done')).toBeTruthy()
    expect(screen.getByText('$1.20')).toBeTruthy()
    expect(screen.getByText('Fix failed CI on my MRs')).toBeTruthy()
    expect(screen.getByText('Fixed lint, pushed 9c1e2f0')).toBeTruthy()
    expect(screen.queryByText('1. fix')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '2 steps' }))
    expect(screen.getByText('1. fix')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hide steps' }))
    expect(screen.queryByText('1. fix')).toBeNull()
  })

  it('lists what the run asked under it, open and answered', () => {
    const run = timelineRun({
      status: 'needs_you',
      inbox: [inboxItem(), inboxItem({ id: 'i2', title: 'Which base?', status: 'answered' })]
    })
    render(
      <ul>
        <RunCard run={run} title="t" />
      </ul>
    )
    expect(screen.getByText('Needs you')).toBeTruthy()
    expect(screen.getByText('Push the fix?')).toBeTruthy()
    expect(screen.getByText('Waiting on you:')).toBeTruthy()
    expect(screen.getByText('Answered:')).toBeTruthy()
  })
})
