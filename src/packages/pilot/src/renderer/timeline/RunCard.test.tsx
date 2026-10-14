// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunEnv } from '../../shared/api-types-env'
import { inboxItem, timelineRun } from './timeline.fixtures'

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
    expect(screen.getByText('Inbox:')).toBeTruthy()
    expect(screen.getByText('Answered:')).toBeTruthy()
  })

  const env = (over: Partial<RunEnv>): RunEnv => ({
    state: 'ready',
    mode: 'throwaway',
    reason: 'uncommitted changes',
    path: '/tmp/t',
    sha: null,
    envFile: null,
    vars: {},
    stack: null,
    removedAt: null,
    deleteError: null,
    deleteAttempts: 0,
    ...over
  })

  it.each([
    [
      'a throwaway with a stack and a failing delete',
      {
        status: 'done' as const,
        env: env({
          stack: {
            kind: 'backend',
            project: 'agents-r1',
            urls: { api: 'http://localhost:8123' },
            log: null
          },
          deleteError: 'docker said no',
          deleteAttempts: 2
        })
      },
      [
        'Worked in a throwaway: uncommitted changes',
        'backend stack agents-r1 · api http://localhost:8123',
        "Couldn't remove it yet (2 tries): docker said no"
      ]
    ],
    [
      'a preparing run',
      { status: 'running' as const, env: env({ state: 'preparing', mode: null, reason: null }) },
      ['Preparing workspace', 'Preparing its workspace']
    ],
    [
      'a deferred run',
      { status: 'cancelled' as const, env: env({ state: 'deferred', mode: null, reason: 'busy' }) },
      ['Deferred', 'Deferred: busy']
    ]
  ])('says where the run worked: %s', (_name, over, texts) => {
    render(
      <ul>
        <RunCard run={timelineRun(over)} title="t" />
      </ul>
    )
    for (const text of texts) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0)
    }
  })
})
