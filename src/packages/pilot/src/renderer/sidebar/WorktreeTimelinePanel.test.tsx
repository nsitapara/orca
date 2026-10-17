// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorktreeTimeline } from '../../shared/api-types'
import { pilotAutomationsView, showAutomationsPage } from '../pages/automations-view'
import { summary } from '../pages/fixtures'
import { resetAutomationsFeed } from '../run-views/automations-feed'
import { closeRunPanel, openRunPanel } from '../run-views/run-panel-state'
import { inboxItem, stepRow, timelineRun, worktreeTimeline } from '../timeline/timeline.fixtures'

let path: string | null = '/wt/a'
let names: { worktree: string | null; project: string | null } = { worktree: null, project: null }
let feed: { data: WorktreeTimeline | null; error: string | null } = { data: null, error: null }
const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))
vi.mock('./active-worktree', () => ({
  useActiveWorktreePath: () => path,
  useActiveWorktreeNames: () => names
}))
vi.mock('./timeline-feed', () => ({ useWorktreeTimeline: () => feed }))

import { WorktreeTimelinePanel } from './WorktreeTimelinePanel'

const NEXT = {
  automationId: 'fix-ci',
  tickId: 9,
  tickAt: 1,
  itemKey: 'mr:1574',
  label: '!1574 web-1474',
  nextTickAt: null
}

describe('WorktreeTimelinePanel', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
    resetAutomationsFeed()
    closeRunPanel()
    showAutomationsPage()
    path = '/wt/a'
    names = { worktree: null, project: null }
    feed = { data: null, error: null }
  })

  it('asks for a worktree when none is open', () => {
    path = null
    render(<WorktreeTimelinePanel />)
    expect(screen.getByText('Open a worktree to see its automations.')).toBeTruthy()
  })

  it.each([
    ['its worktree and project', 'vite-plus-spike', 'web-platform', 'web-platform'],
    ['its path when the project is unknown', 'vite-plus-spike', null, '/wt/a']
  ])('heads the panel with %s', (_name, worktree, project, subtitle) => {
    names = { worktree, project }
    feed = { error: null, data: worktreeTimeline({ spentTodayUsd: 0.84 }) }
    render(<WorktreeTimelinePanel />)
    expect(screen.getByText('vite-plus-spike')).toBeTruthy()
    expect(screen.getByText(subtitle)).toBeTruthy()
    expect(screen.getByText('$0.84 spent here today')).toBeTruthy()
    expect(screen.queryByText('Automations')).toBeNull()
  })

  it('shows the error when there is no timeline yet', () => {
    feed = { data: null, error: "Pilot isn't running" }
    render(<WorktreeTimelinePanel />)
    expect(screen.getByText("Pilot isn't running")).toBeTruthy()
  })

  it('says "+ unpriced" when some of today\'s usage had no price', () => {
    feed = { error: null, data: worktreeTimeline({ spentTodayUsd: 0.84, unpricedBuckets: 2 }) }
    render(<WorktreeTimelinePanel />)
    expect(screen.getByText('$0.84 + unpriced spent here today')).toBeTruthy()
  })

  it('shows spend, loose waiting items, next, now and earlier today', () => {
    feed = {
      error: null,
      data: worktreeTimeline({
        spentTodayUsd: 0.84,
        waiting: [
          inboxItem({ id: 'loose', runId: null, title: 'Which base branch?' }),
          inboxItem()
        ],
        next: [
          {
            ...NEXT,
            automationName: 'Fix failed CI on my MRs',
            verdict: 'skipped',
            reason: '2 uncommitted files'
          },
          {
            ...NEXT,
            automationId: 'review',
            automationName: 'Review branch code',
            verdict: 'notdue',
            reason: 'No new commits'
          }
        ],
        now: [
          timelineRun({
            id: 'r2',
            status: 'running',
            automationName: 'Address feedback',
            inbox: []
          })
        ],
        earlier: [timelineRun({ automationName: 'Fix CI earlier', inbox: [inboxItem()] })]
      })
    }
    render(<WorktreeTimelinePanel />)
    expect(screen.getByText('$0.84 spent here today')).toBeTruthy()
    expect(screen.getByText('Which base branch?')).toBeTruthy()
    expect(screen.getAllByText('Push the fix?')).toHaveLength(1)
    expect(screen.getByText('Fix failed CI on my MRs')).toBeTruthy()
    expect(screen.getByText('2 uncommitted files')).toBeTruthy()
    expect(screen.queryByText('Review branch code')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 with nothing due' }))
    expect(screen.getByText('Review branch code')).toBeTruthy()
    expect(screen.getByText('Address feedback')).toBeTruthy()
    expect(screen.getByText('Fix CI earlier')).toBeTruthy()
    expect(screen.getAllByText('Fixed lint, pushed 9c1e2f0')).toHaveLength(2)
  })

  it('says when nothing is due, running or done here today', () => {
    feed = { error: null, data: worktreeTimeline() }
    render(<WorktreeTimelinePanel />)
    expect(screen.getByText('Nothing due here.')).toBeTruthy()
    expect(screen.getByText('Nothing running.')).toBeTruthy()
    expect(screen.getByText('No runs here today.')).toBeTruthy()
  })

  it("opens a run's panel over the Automations page's Activity, from its row or a chip of its strip", async () => {
    pilotRpc.mockResolvedValue({
      automations: [summary],
      errors: [],
      peopleError: null,
      missingDirs: []
    })
    feed = {
      error: null,
      data: worktreeTimeline({
        now: [
          timelineRun({
            id: 'r2',
            status: 'running',
            steps: [stepRow({ status: 'running' })],
            inbox: []
          })
        ]
      })
    }
    render(<WorktreeTimelinePanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Agent · 1 fix · Running' }))
    expect([openRunPanel(), pilotAutomationsView()]).toEqual([
      { runId: 'r2', part: 'step:0' },
      'activity'
    ])
    closeRunPanel()
    fireEvent.click(
      screen.getByRole('button', { name: 'Open !1561 web-1493 · Fix failed CI on my MRs' })
    )
    expect(openRunPanel()).toEqual({ runId: 'r2', part: null })
  })

  it("shows a finished run's cleanup that hasn't finished, in its row", () => {
    const env = {
      state: 'ready',
      mode: 'throwaway',
      reason: null,
      path: '/tmp/t',
      sha: null,
      envFile: null,
      vars: {},
      stack: null,
      removedAt: null,
      deleteError: 'docker said no',
      deleteAttempts: 2
    } as const
    feed = { error: null, data: worktreeTimeline({ earlier: [timelineRun({ env, inbox: [] })] }) }
    render(<WorktreeTimelinePanel />)
    expect(screen.getByText("Couldn't remove it yet (2 tries): docker said no")).toBeTruthy()
  })
})
