import { cn } from '@/lib/utils'

/** A worktree's name and, beside it, its project: a worktree header's title and an Inactive row's.
 *  A long name truncates first, so the project stays readable. It fills the line. */
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
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
      <span className={cn('min-w-0 truncate text-[13px]', nameClassName)} title={name}>
        {name}
      </span>
      {project ? (
        <span
          className="max-w-[45%] shrink-0 truncate text-2xs text-muted-foreground"
          title={project}
        >
          {project}
        </span>
      ) : null}
    </span>
  )
}
