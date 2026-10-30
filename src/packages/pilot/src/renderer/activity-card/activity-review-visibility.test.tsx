// @vitest-environment happy-dom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostedReviewInfo } from '../../../../../shared/hosted-review'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { useVisibleHostedReviewRefresh } from '@/app-shell/use-visible-hosted-review-refresh'
import { useVisibleReviewRefreshReporting } from '@/app-shell/use-visible-review-refresh-reporting'
import { useAppStore } from '@/store'
import { getHostedReviewCacheKey } from '@/store/slices/hosted-review-cache-identity'
import { _clearHostedReviewRequestGenerationsForTest } from '@/store/slices/hosted-review-request-state'
import { registerPilotStore } from '../store'
import { useActivityReviewVisibility } from './activity-review-visibility'

vi.mock('@/store', async () => {
  const browserWindow = globalThis.window
  const { createTestStore } = await import('@/store/slices/github-slice-test-harness')
  globalThis.window = browserWindow
  return { useAppStore: createTestStore() }
})

const repo: Repo = {
  id: 'repo',
  path: '/repo',
  displayName: 'Web',
  badgeColor: '',
  addedAt: 1,
  gitRemoteIdentity: {
    canonicalKey: 'gitlab.com/acme/web',
    remoteName: 'origin',
    remoteUrl: 'https://gitlab.com/acme/web.git'
  }
}
const worktree: Worktree = {
  id: 'repo::/repo/feature',
  repoId: 'repo',
  path: '/repo/feature',
  displayName: 'Feature',
  branch: 'refs/heads/feature',
  head: 'head',
  comment: '',
  linkedIssue: null,
  linkedPR: null,
  linkedGitLabMR: 7,
  linkedLinearIssue: null,
  isBare: false,
  isMainWorktree: false,
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 1
}
const branchKey = getHostedReviewCacheKey(repo.path, 'feature', null, repo.id, null, null, true)
const mr = (state: HostedReviewInfo['state']): HostedReviewInfo => ({
  provider: 'gitlab',
  number: 7,
  title: 'Feature',
  url: 'https://gitlab.com/acme/web/-/merge_requests/7',
  state,
  status: 'success',
  mergeable: 'UNKNOWN',
  updatedAt: '2026-10-29',
  headSha: 'head'
})
const forBranch = vi.fn(async () => mr('merged'))

function Row({ worktreeId }: { worktreeId: string }): null {
  useActivityReviewVisibility(worktreeId)
  return null
}
function App({ activityRow }: { activityRow: boolean }): React.JSX.Element {
  useVisibleReviewRefreshReporting()
  useVisibleHostedReviewRefresh({ enabled: true })
  return <>{activityRow ? <Row worktreeId={worktree.id} /> : null}</>
}

const visibleIds = (): readonly string[] => useAppStore.getState().visibleReviewCardWorktreeIds

describe('useActivityReviewVisibility', () => {
  beforeEach(() => {
    _clearHostedReviewRequestGenerationsForTest()
    registerPilotStore(useAppStore)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        hostedReview: { forBranch },
        gh: { reportVisiblePRRefreshCandidates: vi.fn(async () => undefined) }
      }
    })
    useAppStore.setState({
      settings: null,
      repos: [repo],
      worktreesByRepo: { repo: [worktree] },
      activeWorktreeId: null,
      prCache: {},
      // Fetched on mount while still open, ten minutes before the merge.
      hostedReviewCache: { [branchKey]: { data: mr('open'), fetchedAt: Date.now() - 600_000 } }
    })
  })
  afterEach(() => {
    cleanup()
    useAppStore.getState().setVisibleReviewCardWorktreeIds([])
    registerPilotStore(null)
    vi.clearAllMocks()
  })

  it('keeps an Activity row in the visible review set beside the Workspaces list until it unmounts', () => {
    useAppStore.getState().setVisibleReviewCardWorktreeIds(['list-a'])
    const first = render(<Row worktreeId="activity-b" />)
    const second = render(<Row worktreeId="activity-b" />)
    expect(visibleIds()).toEqual(['list-a', 'activity-b'])

    // The Workspaces list publishes [] when it unmounts; Activity rows keep their place.
    useAppStore.getState().setVisibleReviewCardWorktreeIds([])
    expect(visibleIds()).toEqual(['activity-b'])

    first.unmount()
    expect(visibleIds()).toEqual(['activity-b'])
    second.unmount()
    expect(visibleIds()).toEqual([])
  })

  it.each([
    { activityRow: true, state: 'merged' },
    { activityRow: false, state: 'open' }
  ])(
    'refreshes a GitLab MR shown only in Activity (row mounted: $activityRow)',
    async ({ activityRow, state }) => {
      render(<App activityRow={activityRow} />)
      if (activityRow) {
        await waitFor(() => expect(forBranch).toHaveBeenCalled())
      } else {
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(forBranch).not.toHaveBeenCalled()
      }
      await waitFor(() =>
        expect(useAppStore.getState().hostedReviewCache[branchKey]?.data?.state).toBe(state)
      )
    }
  )
})
