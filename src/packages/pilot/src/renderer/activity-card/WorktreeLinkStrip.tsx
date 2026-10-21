import type React from 'react'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import type { WorktreeCardPrDisplay } from '@/components/sidebar/worktree-card-pr-display'
import { getProviderName, getReviewLabel } from '@/components/sidebar/worktree-review-helpers'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { openHttpLink } from '@/lib/http-link-routing'
import { cn } from '@/lib/utils'
import { LinearStateMark } from './LinearStateMark'
import { reviewPipelineMark, reviewStateMark } from './review-state-mark'
import { useWorktreeLinks, type WorktreeLinearLink } from './worktree-links'
import { useWorktreeLivePorts, WorktreePortsChip } from './WorktreePortsChip'

const CHIP_CLASS =
  'inline-flex min-w-0 shrink-0 cursor-pointer items-center gap-1 rounded border border-border/60 bg-muted/40 px-1 py-px text-[11px] font-medium leading-4 tabular-nums text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default'

// Chips sit inside the worktree header: a click or Enter opens the link, never the worktree.
function chipHandlers(url: string | undefined, worktreeId: string) {
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
  worktreeId: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={CHIP_CLASS}
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
  worktreeId: string
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
  worktreeId: string
}): React.JSX.Element {
  return (
    <Chip label={linearChipLabel(linear)} url={linear.url} worktreeId={worktreeId}>
      <LinearStateMark stateType={linear.stateType} color={linear.stateColor} className="size-3" />
      <span className="truncate">{linear.identifier}</span>
    </Chip>
  )
}

/**
 * A worktree's MR/PR, Linear issue and live ports, as chips under its name. Status rides on each
 * chip's icon and colour; the words are in its tooltip. Nothing when it has none of the three.
 */
export function WorktreeLinkStrip({
  worktree,
  repo,
  className
}: {
  worktree: Worktree
  repo: Repo | null
  className?: string
}): React.JSX.Element | null {
  const { review, linear } = useWorktreeLinks(worktree, repo)
  const ports = useWorktreeLivePorts(worktree.id)
  if (!review && !linear && ports.length === 0) {
    return null
  }
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
      {review ? <ReviewChip review={review} worktreeId={worktree.id} /> : null}
      {linear ? <LinearChip linear={linear} worktreeId={worktree.id} /> : null}
      {ports.length > 0 ? (
        <WorktreePortsChip worktree={worktree} repo={repo} ports={ports} />
      ) : null}
    </div>
  )
}
