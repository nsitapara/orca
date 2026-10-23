import type React from 'react'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import type { WorktreeCardPrDisplay } from '@/components/sidebar/worktree-card-pr-display'
import { getProviderName, getReviewLabel } from '@/components/sidebar/worktree-review-helpers'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { openHttpLink } from '@/lib/http-link-routing'
import { cn } from '@/lib/utils'
import { worktreeGitChipView } from './git-sync-mark'
import { useBranchLinearIssue } from './linear-branch-issue'
import { LinearStateMark } from './LinearStateMark'
import { reviewPipelineMark, reviewStateMark } from './review-state-mark'
import { WORKTREE_CHIP_CLASS } from './worktree-chip-class'
import { useWorktreeGitSync } from './worktree-git-sync-feed'
import { useWorktreeLinks, type WorktreeLinearLink } from './worktree-links'
import { WorktreeGitChip } from './WorktreeGitChip'
import { useWorktreeLivePorts, WorktreePortsChip } from './WorktreePortsChip'

// Chips sit inside the worktree header: a click or Enter opens the link, never the worktree.
function chipHandlers(url: string | undefined, worktreeId: string | undefined) {
  return {
    disabled: !url,
    onMouseDown: (event: React.MouseEvent) => event.stopPropagation(),
    onKeyDown: (event: React.KeyboardEvent) => event.stopPropagation(),
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation()
      if (url) {
        openHttpLink(url, { worktreeId, modifierHeld: event.shiftKey })
      }
    }
  }
}

function Chip({
  label,
  url,
  worktreeId,
  children
}: {
  label: string
  url: string | undefined
  worktreeId: string | undefined
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={WORKTREE_CHIP_CLASS}
          {...chipHandlers(url, worktreeId)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function reviewName(review: WorktreeCardPrDisplay): string {
  return `${review.provider === 'gitlab' ? '!' : '#'}${review.number}`
}

export function reviewChipLabel(review: WorktreeCardPrDisplay): string {
  const pipeline = reviewPipelineMark(review)
  return [
    `${getProviderName(review)} ${getReviewLabel(review)} ${reviewName(review)}`,
    reviewStateMark(review).label,
    pipeline?.label
  ]
    .filter(Boolean)
    .join(' · ')
}

function ReviewChip({
  review,
  worktreeId
}: {
  review: WorktreeCardPrDisplay
  worktreeId: string | undefined
}): React.JSX.Element {
  const state = reviewStateMark(review)
  const pipeline = reviewPipelineMark(review)
  return (
    <Chip label={reviewChipLabel(review)} url={review.url} worktreeId={worktreeId}>
      <state.Icon className={cn('size-3 shrink-0', state.tone)} />
      {reviewName(review)}
      {pipeline ? <pipeline.Icon className={cn('size-3 shrink-0', pipeline.tone)} /> : null}
    </Chip>
  )
}

export function linearChipLabel(linear: WorktreeLinearLink): string {
  return [linear.identifier, linear.stateName, linear.title].filter(Boolean).join(' · ')
}

function LinearChip({
  linear,
  worktreeId
}: {
  linear: WorktreeLinearLink
  worktreeId: string | undefined
}): React.JSX.Element {
  return (
    <Chip label={linearChipLabel(linear)} url={linear.url} worktreeId={worktreeId}>
      <LinearStateMark stateType={linear.stateType} color={linear.stateColor} className="size-3" />
      <span className="truncate">{linear.identifier}</span>
    </Chip>
  )
}

/**
 * An MR/PR and a Linear issue as chips, then any more (`children`). Status rides on each chip's icon
 * and colour; the words are in its tooltip. `worktreeId`: where a link may open in the app; none for an
 * item no worktree holds. Nothing when there is none.
 */
export function LinkChips({
  review,
  linear,
  worktreeId,
  className,
  children
}: {
  review: WorktreeCardPrDisplay | null
  linear: WorktreeLinearLink | null
  worktreeId?: string
  className?: string
  children?: React.ReactNode
}): React.JSX.Element | null {
  if (!review && !linear && !children) {
    return null
  }
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
      {review ? <ReviewChip review={review} worktreeId={worktreeId} /> : null}
      {linear ? <LinearChip linear={linear} worktreeId={worktreeId} /> : null}
      {children}
    </div>
  )
}

/**
 * A worktree's MR/PR, Linear issue, git state and live ports, as chips under its name. With no linked
 * issue, the one its branch is named for. `canPush` false keeps the git chip to showing state, where a
 * push must go through its own gate (an Inbox card's Push to origin).
 */
export function WorktreeLinkStrip({
  worktree,
  repo,
  className,
  canPush = true
}: {
  worktree: Worktree
  repo: Repo | null
  className?: string
  canPush?: boolean
}): React.JSX.Element | null {
  const { review, linear } = useWorktreeLinks(worktree, repo)
  const branchLinear = useBranchLinearIssue(linear ? null : worktree.branch)
  const git = useWorktreeGitSync(worktree, repo)
  const gitView = worktreeGitChipView(git.sync)
  const ports = useWorktreeLivePorts(worktree.id)
  const gitChip = gitView ? (
    <WorktreeGitChip worktree={worktree} view={gitView} pushing={git.pushing} canPush={canPush} />
  ) : null
  const portsChip =
    ports.length > 0 ? <WorktreePortsChip worktree={worktree} repo={repo} ports={ports} /> : null
  return (
    <LinkChips
      review={review}
      linear={linear ?? branchLinear}
      worktreeId={worktree.id}
      className={className}
    >
      {gitChip || portsChip ? (
        <>
          {gitChip}
          {portsChip}
        </>
      ) : null}
    </LinkChips>
  )
}
