// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitStatusResult, GitUpstreamStatus } from '../../../../../shared/git-status-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { makeRepo, makeWorktree } from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { TooltipProvider } from '@/components/ui/tooltip'
import type * as ResolveOwner from '@/lib/resolve-owner'
import { getRuntimeGitBranchCompare } from '@/runtime/runtime-git-diff-client'
import { getRuntimeGitStatus } from '@/runtime/runtime-git-status-client'
import { useAppStore } from '@/store'
import { openActivityWorktree } from '../activity-tabs/open-activity-worktree'
import { registerPilotStore } from '../store'
import { gitSyncMark, worktreeGitChipView } from './git-sync-mark'
import { resetWorktreeGitSyncFeeds, type WorktreeGitSync } from './worktree-git-sync-feed'
import { WorktreeLinkStrip } from './WorktreeLinkStrip'

vi.mock('@/lib/resolve-owner', async (importOriginal) => ({
  ...(await importOriginal<typeof ResolveOwner>()),
  runtimeTargetForWorkspaceOwner: () => ({ kind: 'local' })
}))
vi.mock('@/runtime/runtime-git-status-client', () => ({ getRuntimeGitStatus: vi.fn() }))
vi.mock('@/runtime/runtime-git-diff-client', () => ({ getRuntimeGitBranchCompare: vi.fn() }))
vi.mock('../activity-tabs/open-activity-worktree', () => ({ openActivityWorktree: vi.fn() }))

const UPSTREAM = 'origin/feature'

function tracked(ahead: number, behind: number): GitUpstreamStatus {
  return { hasUpstream: true, upstreamName: UPSTREAM, ahead, behind }
}

const UNPUBLISHED: GitUpstreamStatus = { hasUpstream: false, ahead: 0, behind: 0 }

function sync(overrides: Partial<WorktreeGitSync> = {}): WorktreeGitSync {
  return {
    changes: 0,
    changesCapped: false,
    onBranch: true,
    upstream: tracked(0, 0),
    unpublishedCommits: null,
    ...overrides
  }
}

function status(upstreamStatus: GitUpstreamStatus): GitStatusResult {
  return {
    entries: [],
    conflictOperation: 'unknown',
    head: 'abc123',
    branch: 'refs/heads/feature',
    upstreamStatus
  }
}

describe('the git chip’s state', () => {
  it.each([
    {
      name: 'commits to push',
      sync: sync({ upstream: tracked(2, 0) }),
      mark: ['ArrowUp', 'text-status-warning', '2', 'push', 'Push 2 commits to origin/feature']
    },
    {
      name: 'in sync',
      sync: sync(),
      mark: ['CloudCheck', 'text-status-success', null, 'open', 'In sync with origin/feature']
    },
    {
      name: 'behind',
      sync: sync({ upstream: tracked(0, 1) }),
      mark: [
        'ArrowDown',
        'text-muted-foreground',
        '1',
        'open',
        '1 commit to pull from origin/feature'
      ]
    },
    {
      name: 'diverged',
      sync: sync({ upstream: tracked(2, 3) }),
      mark: [
        'ArrowDownUp',
        'text-status-warning',
        '2↑ 3↓',
        'open',
        'Diverged from origin/feature: 2 commits to push, 3 to pull. Sync in Source Control'
      ]
    },
    {
      name: 'unpublished with commits',
      sync: sync({ upstream: UNPUBLISHED, unpublishedCommits: 4 }),
      mark: [
        'CloudUpload',
        'text-status-warning',
        '4',
        'publish',
        'Publish branch: 4 commits not on origin'
      ]
    },
    {
      name: 'unpublished with no base to count from',
      sync: sync({ upstream: UNPUBLISHED }),
      mark: [
        'CloudUpload',
        'text-muted-foreground',
        null,
        'publish',
        'Publish branch: not on origin yet'
      ]
    },
    {
      name: 'unpublished with no commits',
      sync: sync({ upstream: UNPUBLISHED, unpublishedCommits: 0 }),
      mark: null
    },
    { name: 'detached', sync: sync({ onBranch: false, upstream: tracked(2, 0) }), mark: null }
  ])('$name', ({ sync, mark }) => {
    const result = gitSyncMark(sync)
    expect(
      result && [result.Icon.displayName, result.tone, result.count, result.action, result.label]
    ).toEqual(mark)
  })

  it.each([
    {
      sync: sync({ changes: 3 }),
      changes: '3',
      label: 'In sync with origin/feature · 3 uncommitted changes'
    },
    {
      sync: sync({ onBranch: false, changes: 1000, changesCapped: true }),
      changes: '1000+',
      label: '1000+ uncommitted changes'
    },
    { sync: sync({ onBranch: false }), changes: null, label: null }
  ])('uncommitted changes ride beside the branch: $label', ({ sync, changes, label }) => {
    const view = worktreeGitChipView(sync)
    expect(view && [view.changes, view.label]).toEqual(label === null ? null : [changes, label])
  })
})

describe('the git chip in the worktree strip', () => {
  const pushBranch = vi.fn(async () => {})
  const setRightSidebarTab = vi.fn()
  const setRightSidebarOpen = vi.fn()
  let before: ReturnType<typeof useAppStore.getState>

  beforeEach(() => {
    before = useAppStore.getState()
    registerPilotStore(useAppStore)
    useAppStore.setState({
      repos: [makeRepo()],
      worktreesByRepo: { 'repo-1': [makeWorktree()] },
      pushBranch,
      setRightSidebarTab,
      setRightSidebarOpen
    })
  })

  afterEach(() => {
    cleanup()
    resetWorktreeGitSyncFeeds()
    useAppStore.setState({
      pushBranch: before.pushBranch,
      setRightSidebarTab: before.setRightSidebarTab,
      setRightSidebarOpen: before.setRightSidebarOpen
    })
    registerPilotStore(null)
    vi.clearAllMocks()
  })

  function renderStrip(worktree: Worktree, canPush = true) {
    const openRow = vi.fn()
    const view = render(
      <TooltipProvider>
        <div onClick={openRow}>
          <WorktreeLinkStrip worktree={worktree} repo={makeRepo()} canPush={canPush} />
        </div>
      </TooltipProvider>
    )
    return { view, openRow }
  }

  it('pushes the branch on click, not opening the row, then shows it in sync', async () => {
    vi.mocked(getRuntimeGitStatus)
      .mockResolvedValueOnce(status(tracked(2, 0)))
      .mockResolvedValue(status(tracked(0, 0)))
    const { view, openRow } = renderStrip(makeWorktree())

    fireEvent.click(await view.findByRole('button', { name: 'Push 2 commits to origin/feature' }))

    expect(pushBranch).toHaveBeenCalledWith('wt-1', '/repo/wt-1', false, undefined, undefined)
    expect(openRow).not.toHaveBeenCalled()
    await view.findByRole('button', { name: 'In sync with origin/feature' })
  })

  it('publishes an unpublished branch with commits past its base', async () => {
    vi.mocked(getRuntimeGitStatus).mockResolvedValue(status(UNPUBLISHED))
    vi.mocked(getRuntimeGitBranchCompare).mockResolvedValue({
      summary: {
        baseRef: 'origin/dev',
        baseOid: 'base',
        compareRef: 'HEAD',
        headOid: 'abc123',
        mergeBase: 'base',
        changedFiles: 1,
        commitsAhead: 2,
        status: 'ready'
      },
      entries: []
    })
    const { view } = renderStrip({ ...makeWorktree(), baseRef: 'origin/dev' })

    fireEvent.click(
      await view.findByRole('button', { name: 'Publish branch: 2 commits not on origin' })
    )

    expect(getRuntimeGitBranchCompare).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'wt-1' }),
      'origin/dev',
      'background'
    )
    expect(pushBranch).toHaveBeenCalledWith('wt-1', '/repo/wt-1', true, undefined, undefined)
  })

  it('where it may not push, opens the worktree’s Source Control instead', async () => {
    vi.mocked(getRuntimeGitStatus).mockResolvedValue(status(tracked(2, 0)))
    const { view } = renderStrip(makeWorktree(), false)

    fireEvent.click(await view.findByRole('button', { name: 'Push 2 commits to origin/feature' }))

    await waitFor(() => expect(setRightSidebarTab).toHaveBeenCalledWith('source-control'))
    expect(openActivityWorktree).toHaveBeenCalledWith(expect.objectContaining({ id: 'wt-1' }))
    expect(setRightSidebarOpen).toHaveBeenCalledWith(true)
    expect(pushBranch).not.toHaveBeenCalled()
  })
})
