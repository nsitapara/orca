import type { AgentPaneThread } from '@/components/activity/activity-thread-types'
import { useWorktreeCardFoundation } from '@/components/sidebar/use-worktree-card-foundation'
import { useWorktreeCardLifecycleEffects } from '@/components/sidebar/use-worktree-card-lifecycle-effects'
import { useWorktreeCardLinkedDetails } from '@/components/sidebar/use-worktree-card-linked-details'
import { useWorktreeCardReviewDetails } from '@/components/sidebar/use-worktree-card-review-details'
import { useWorktreeCardSecondaryDetails } from '@/components/sidebar/use-worktree-card-secondary-details'

/**
 * The details upstream's Activity hover card gathers (activity-thread-hover-card.tsx), wired the
 * same way, so Pilot's card shows the same review, issues, notes and ports.
 */
export function useHoverCardDetails(thread: AgentPaneThread, hoverOpen: boolean) {
  const { worktree, repo } = thread
  const foundation = useWorktreeCardFoundation({ worktree, repo: repo ?? undefined })
  const review = useWorktreeCardReviewDetails({
    worktree,
    repo: repo ?? undefined,
    settings: foundation.settings,
    projectGroups: foundation.projectGroups,
    cardProps: foundation.cardProps,
    newCardStyle: foundation.newCardStyle
  })
  const linked = useWorktreeCardLinkedDetails({
    worktree,
    newCardStyle: foundation.newCardStyle,
    deleteState: foundation.deleteState,
    branch: review.branch,
    issueEntry: review.issueEntry,
    linearIssueEntry: review.linearIssueEntry,
    linearIssueFallbackEntry: review.linearIssueFallbackEntry,
    prDisplay: review.prDisplay
  })

  useWorktreeCardLifecycleEffects({
    worktree,
    repo: repo ?? undefined,
    isFolder: review.isFolder,
    hostedReviewCacheKey: review.hostedReviewCacheKey,
    cachedBranchFallbackGitHubPRNumber: review.cachedBranchFallbackGitHubPRNumber,
    linkedGitLabMR: review.linkedGitLabMR,
    linkedBitbucketPR: review.linkedBitbucketPR,
    linkedAzureDevOpsPR: review.linkedAzureDevOpsPR,
    linkedGiteaPR: review.linkedGiteaPR,
    branch: review.branch,
    fetchHostedReviewForBranch: foundation.fetchHostedReviewForBranch,
    shouldRefreshHostedReview: false,
    newCardStyle: true,
    hoverDetailsOpen: hoverOpen,
    showIssue: true,
    issueCacheKey: review.issueCacheKey,
    fetchIssue: foundation.fetchIssue,
    showLinearIssue: true,
    fetchLinearIssue: foundation.fetchLinearIssue,
    linearSourceContext: review.linearSourceContext,
    linearWorkspaceId: review.linearWorkspaceId
  })

  const secondary = useWorktreeCardSecondaryDetails({
    worktree,
    repo: repo ?? undefined,
    statusPrDisplay: null,
    showStatus: true,
    showIssue: true,
    showLinearIssue: true,
    showJiraIssue: true,
    showPR: true,
    showAutomation: true,
    showCli: true,
    showComment: true,
    showPorts: true,
    issueDisplay: linked.issueDisplay,
    linearIssue: linked.linearIssue,
    linearIssueDisplay: linked.linearIssueDisplay,
    jiraIssueDisplay: linked.jiraIssueDisplay,
    prDisplay: review.prDisplay,
    linkedGitLabMR: review.linkedGitLabMR,
    linkedBitbucketPR: review.linkedBitbucketPR,
    linkedAzureDevOpsPR: review.linkedAzureDevOpsPR,
    linkedGiteaPR: review.linkedGiteaPR,
    newCardStyle: foundation.newCardStyle,
    compactCards: foundation.compactCards,
    cardDetails: foundation.cardDetails,
    agentActivityDisplayMode: foundation.agentActivityDisplayMode,
    workspacePorts: foundation.workspacePorts,
    openTaskPage: foundation.openTaskPage,
    updateWorktreeMeta: foundation.updateWorktreeMeta,
    settings: foundation.settings
  })

  return { foundation, secondary }
}
