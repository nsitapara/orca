import { GitBranch } from 'lucide-react'
import type { CardHome } from './use-inbox-sections'
import { WorktreeChips } from './WorktreeChips'
import { isWorktreeGroup, WorktreeName } from './WorktreeLink'

// A card's first line, where its work is: the project, then its worktree (or MR, pipeline, ticket) and that
// worktree's chips. It is the card's top band, out to the card's edges.
export function CardPlace({ home }: { home: CardHome }): React.JSX.Element {
  return (
    <div
      data-card-place=""
      className="-mx-3.5 -mt-3 flex min-w-0 items-center gap-2 rounded-t-[9px] border-b border-border bg-muted/40 px-3.5 py-1.5 text-xs text-muted-foreground"
    >
      {home.project ? (
        <>
          <span className="shrink-0">{home.project}</span>
          <span aria-hidden>/</span>
        </>
      ) : null}
      {isWorktreeGroup(home.group) ? <GitBranch aria-hidden className="size-3.5 shrink-0" /> : null}
      <span className="flex min-w-0 flex-1 font-mono text-[12.5px] font-medium">
        <WorktreeName group={home.group} host={home.host} />
      </span>
      <WorktreeChips group={home.group} host={home.host} />
    </div>
  )
}
