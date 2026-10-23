import { cn } from '@/lib/utils'

// Each part takes up to its own width and they share what's left: a short name leaves the project
// whole, a short project leaves the name the rest, and two long ones get half each.
function columnsFor(project: string | null): string {
  if (project) {
    return 'grid-cols-[minmax(0,max-content)_minmax(0,max-content)]'
  }
  return 'grid-cols-[minmax(0,max-content)]'
}

/** A worktree's name and, beside it, its project: a worktree header's title and an Inactive row's.
 *  It fills the line. */
export function WorktreeTitle({
  name,
  project,
  nameClassName
}: {
  name: string
  project: string | null
  nameClassName: string
}): React.JSX.Element {
  return (
    <span className={cn('grid min-w-0 flex-1 items-baseline gap-x-1.5', columnsFor(project))}>
      <span className={cn('min-w-0 truncate text-[13px]', nameClassName)} title={name}>
        {name}
      </span>
      {project ? (
        <span className="min-w-0 truncate text-2xs text-muted-foreground" title={project}>
          {project}
        </span>
      ) : null}
    </span>
  )
}
