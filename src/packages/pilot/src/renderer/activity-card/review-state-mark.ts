import {
  CircleCheck,
  CircleDashed,
  CircleX,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type LucideIcon
} from 'lucide-react'
import type { WorktreeCardPrDisplay } from '@/components/sidebar/worktree-card-pr-display'

export type ReviewMark = { Icon: LucideIcon; tone: string; label: string }

/**
 * An MR/PR's state as its host draws it. GitLab's badges: Open green, Draft amber on the same icon,
 * Closed red, Merged blue. GitHub, and the hosts without their own palette: Draft grey on its own
 * icon, Merged purple.
 */
export function reviewStateMark(review: WorktreeCardPrDisplay): ReviewMark {
  const gitlab = review.provider === 'gitlab'
  switch (review.state) {
    case 'open':
      return { Icon: GitPullRequest, tone: 'text-status-success', label: 'Open' }
    case 'draft':
      return gitlab
        ? { Icon: GitPullRequest, tone: 'text-status-warning', label: 'Draft' }
        : { Icon: GitPullRequestDraft, tone: 'text-muted-foreground', label: 'Draft' }
    case 'closed':
      return { Icon: GitPullRequestClosed, tone: 'text-destructive', label: 'Closed' }
    case 'merged':
      return {
        Icon: GitMerge,
        tone: gitlab ? 'text-callout-note' : 'text-callout-important',
        label: 'Merged'
      }
    case undefined:
      return { Icon: GitPullRequest, tone: 'text-muted-foreground', label: 'State unknown' }
  }
}

/** The pipeline (GitLab) or checks (GitHub) of a review still in flight; none once it's merged or closed. */
export function reviewPipelineMark(review: WorktreeCardPrDisplay): ReviewMark | null {
  if (review.state === 'merged' || review.state === 'closed') {
    return null
  }
  const gitlab = review.provider === 'gitlab'
  const noun = gitlab ? 'Pipeline' : 'Checks'
  switch (review.status) {
    case 'success':
      return { Icon: CircleCheck, tone: 'text-status-success', label: `${noun} passed` }
    case 'failure':
      return { Icon: CircleX, tone: 'text-destructive', label: `${noun} failed` }
    case 'pending':
      // GitLab draws a running pipeline blue; GitHub's pending checks are amber.
      return gitlab
        ? { Icon: CircleDashed, tone: 'text-callout-note', label: 'Pipeline in progress' }
        : { Icon: CircleDashed, tone: 'text-status-warning', label: 'Checks pending' }
    case 'neutral':
    case undefined:
      return null
  }
}
