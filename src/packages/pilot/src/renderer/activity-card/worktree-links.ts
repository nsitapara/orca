import type { Repo } from '../../../../../shared/repo-types'
import { getWorkspaceAttachments } from '../../../../../shared/workspace-attachments'
import type { Worktree } from '../../../../../shared/worktree/types'
import { useWorktreeCardLifecycleEffects } from '@/components/sidebar/use-worktree-card-lifecycle-effects'
import { useWorktreeCardReviewDetails } from '@/components/sidebar/use-worktree-card-review-details'
import type { WorktreeCardPrDisplay } from '@/components/sidebar/worktree-card-pr-display'
import { useAppStore } from '@/store'

type ReviewDetailsInput = Parameters<typeof useWorktreeCardReviewDetails>[0]

// Card properties only pick the card's identity line, which links don't use.
const NO_CARD_PROPS: ReviewDetailsInput['cardProps'] = []

export type WorktreeLinearLink = {
  identifier: string
  stateName?: string
  stateType?: string
  url?: string
}

export type WorktreeLinks = {
  review: WorktreeCardPrDisplay | null
  linear: WorktreeLinearLink | null
}

// The Workspaces card's review lookup: the same caches, keys and PR/MR precedence.
function useReviewDetails(worktree: Worktree, repo: Repo | null) {
  const settings = useAppStore((s) => s.settings)
  const projectGroups = useAppStore((s) => s.projectGroups)
  return useWorktreeCardReviewDetails({
    worktree,
    repo: repo ?? undefined,
    settings,
    projectGroups,
    cardProps: NO_CARD_PROPS,
    newCardStyle: true
  })
}

/** A worktree's MR/PR and Linear issue as the caches hold them; never fetches. */
export function useWorktreeLinks(worktree: Worktree, repo: Repo | null): WorktreeLinks {
  const details = useReviewDetails(worktree, repo)
  const linearId = worktree.linkedLinearIssue
  if (!linearId) {
    return { review: details.prDisplay ?? null, linear: null }
  }
  const issue = details.linearIssueEntry?.data ?? details.linearIssueFallbackEntry?.data
  const references = getWorkspaceAttachments(worktree).filter(
    (item) => item.provider === 'linear' && (item.identifier ?? item.linearIdentifier) === linearId
  )
  return {
    review: details.prDisplay ?? null,
    linear: {
      identifier: issue?.identifier ?? linearId,
      stateName: issue?.state?.name,
      stateType: issue?.state?.type,
      url: issue?.url ?? (references.length === 1 ? references[0].url : undefined)
    }
  }
}

/**
 * Fetches a worktree's review and Linear issue once, as its hover card does on open; the stores'
 * TTLs keep a remount from refetching. Rendered once per worktree header, so its rows can read them.
 */
export function WorktreeLinksPrefetch({
  worktree,
  repo
}: {
  worktree: Worktree
  repo: Repo | null
}): null {
  const details = useReviewDetails(worktree, repo)
  const fetchHostedReviewForBranch = useAppStore((s) => s.fetchHostedReviewForBranch)
  const fetchIssue = useAppStore((s) => s.fetchIssue)
  const fetchLinearIssue = useAppStore((s) => s.fetchLinearIssue)
  useWorktreeCardLifecycleEffects({
    worktree,
    repo: repo ?? undefined,
    isFolder: details.isFolder,
    hostedReviewCacheKey: details.hostedReviewCacheKey,
    cachedBranchFallbackGitHubPRNumber: details.cachedBranchFallbackGitHubPRNumber,
    linkedGitLabMR: details.linkedGitLabMR,
    linkedBitbucketPR: details.linkedBitbucketPR,
    linkedAzureDevOpsPR: details.linkedAzureDevOpsPR,
    linkedGiteaPR: details.linkedGiteaPR,
    branch: details.branch,
    fetchHostedReviewForBranch,
    shouldRefreshHostedReview: false,
    newCardStyle: true,
    hoverDetailsOpen: true,
    // Why off: "show" installs polling and focus listeners per card; one fetch per mount is enough here.
    showIssue: false,
    issueCacheKey: details.issueCacheKey,
    fetchIssue,
    showLinearIssue: false,
    linearSourceContext: details.linearSourceContext,
    linearWorkspaceId: details.linearWorkspaceId,
    fetchLinearIssue
  })
  return null
}
