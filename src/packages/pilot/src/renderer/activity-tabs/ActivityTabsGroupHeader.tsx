import type { ReactNode } from 'react'
import { ChevronDown, FolderGit2, Pin } from 'lucide-react'
import type { ActivityThreadGroup } from '@/components/activity/activity-thread-types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { pilotStore } from '../store'
import { activityTabsGroupCount } from './activity-tabs-rows'

const WORKTREE_GROUP = 'worktree:'

type HeaderProps = {
  group: ActivityThreadGroup
  collapsed?: boolean
  onToggle?: () => void
  // Upstream's header, kept for every other group and while Pilot isn't attached.
  children: ReactNode
}

// pilot-hook: activity-tabs-group-header. A worktree group's header reads as a title over its
// sessions, not as one more caption: the worktree in row type, its project beside it, and the
// Workspaces sidebar's pin (a pinned worktree always shows in Activity, first).
export function ActivityTabsGroupHeader({
  group,
  collapsed = false,
  onToggle,
  children
}: HeaderProps): ReactNode {
  const worktreeId = group.key.startsWith(WORKTREE_GROUP)
    ? group.key.slice(WORKTREE_GROUP.length)
    : null
  const project = useAppStore((s) => {
    const repoId = worktreeId ? s.getKnownWorktreeById(worktreeId)?.repoId : undefined
    return s.repos.find((repo) => repo.id === repoId)?.displayName ?? null
  })
  const pinned = useAppStore((s) =>
    worktreeId ? s.getKnownWorktreeById(worktreeId)?.isPinned === true : false
  )
  if (!pilotStore() || !worktreeId) {
    return children
  }
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={!collapsed}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onToggle?.()
        }
      }}
      className="group flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-md px-1.5 text-foreground transition-colors hover:bg-accent/60"
    >
      <ChevronDown
        className={cn(
          'size-3 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:text-foreground',
          collapsed && '-rotate-90'
        )}
      />
      <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 shrink truncate text-[13px] font-semibold" title={group.label}>
        {group.label}
      </span>
      <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">{project}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={pinned ? 'Unpin worktree' : 'Pin worktree'}
            aria-pressed={pinned}
            onClick={(event) => {
              event.stopPropagation()
              useAppStore.getState().setWorktreesPinnedAndReveal([worktreeId], !pinned)
            }}
            onKeyDown={(event) => event.stopPropagation()}
            className={cn(
              'flex size-5 shrink-0 cursor-pointer items-center justify-center rounded transition-opacity hover:bg-accent focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              pinned
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground can-hover:opacity-0 can-hover:group-hover:opacity-100'
            )}
          >
            <Pin className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{pinned ? 'Unpin worktree' : 'Pin worktree'}</TooltipContent>
      </Tooltip>
      <span className="rounded-full border border-border/80 bg-muted/80 px-1.5 py-0.5 text-3xs font-semibold tabular-nums leading-none text-foreground/80 shadow-xs">
        {group.threads.length + activityTabsGroupCount(group)}
      </span>
    </div>
  )
}
