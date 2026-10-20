import type React from 'react'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { LinearIcon } from '@/components/icons/LinearIcon'
import type { WorktreeCardPrDisplay } from '@/components/sidebar/worktree-card-pr-display'
import { getReviewLabel, ReviewIcon } from '@/components/sidebar/worktree-review-helpers'
import { openHttpLink } from '@/lib/http-link-routing'
import { cn } from '@/lib/utils'
import { useWorktreeLinks, type WorktreeLinearLink } from './worktree-links'

type ChipSize = 'row' | 'card'

// Chips sit inside clickable rows: a click opens the link, never the row.
function chipHandlers(url: string | undefined, worktreeId: string) {
  return {
    disabled: !url,
    onMouseDown: (event: React.MouseEvent) => event.stopPropagation(),
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation()
      if (url) {
        openHttpLink(url, { worktreeId, modifierHeld: event.shiftKey })
      }
    }
  }
}

function reviewName(review: WorktreeCardPrDisplay): string {
  return `${review.provider === 'gitlab' ? '!' : '#'}${review.number}`
}

function ReviewChip({
  review,
  worktreeId,
  size
}: {
  review: WorktreeCardPrDisplay
  worktreeId: string
  size: ChipSize
}): React.JSX.Element {
  const state = review.state ? ` · ${review.state}` : ''
  return (
    <button
      type="button"
      title={`Open ${getReviewLabel(review)} ${reviewName(review)}${state}`}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center gap-1 rounded font-medium tabular-nums text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default',
        size === 'card' &&
          'border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[12px] text-foreground'
      )}
      {...chipHandlers(review.url, worktreeId)}
    >
      <ReviewIcon review={review} className={size === 'card' ? 'size-3.5' : 'size-3'} />
      {reviewName(review)}
      {size === 'card' && review.state ? (
        <span className="font-normal capitalize text-muted-foreground">{review.state}</span>
      ) : null}
    </button>
  )
}

function LinearChip({
  linear,
  worktreeId,
  size
}: {
  linear: WorktreeLinearLink
  worktreeId: string
  size: ChipSize
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={`Open ${linear.identifier} in Linear`}
      className={cn(
        'inline-flex min-w-0 cursor-pointer items-center gap-1 rounded border border-border/60 bg-muted/40 px-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default',
        size === 'card' && 'px-1.5 py-0.5 text-[12px] text-foreground'
      )}
      {...chipHandlers(linear.url, worktreeId)}
    >
      <LinearIcon className={cn('shrink-0', size === 'card' ? 'size-3' : 'size-2.5')} />
      <span className="shrink-0 font-medium">{linear.identifier}</span>
      {linear.stateName ? (
        <span className="min-w-0 truncate text-muted-foreground">· {linear.stateName}</span>
      ) : null}
    </button>
  )
}

/** A worktree's MR/PR and Linear issue as chips that open them; nothing when it has neither. */
export function WorktreeLinkChips({
  worktree,
  repo,
  size = 'row'
}: {
  worktree: Worktree
  repo: Repo | null
  size?: ChipSize
}): React.JSX.Element | null {
  const { review, linear } = useWorktreeLinks(worktree, repo)
  if (!review && !linear) {
    return null
  }
  return (
    <span className={cn('flex min-w-0 items-center', size === 'card' ? 'gap-2' : 'gap-1.5')}>
      {review ? <ReviewChip review={review} worktreeId={worktree.id} size={size} /> : null}
      {linear ? <LinearChip linear={linear} worktreeId={worktree.id} size={size} /> : null}
    </span>
  )
}
