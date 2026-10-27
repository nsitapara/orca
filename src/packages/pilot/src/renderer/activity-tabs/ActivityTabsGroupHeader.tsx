import type { ReactNode } from 'react'
import { ChevronDown, FolderGit2, Pin } from 'lucide-react'
import type { ActivityThreadGroup } from '@/components/activity/activity-thread-types'
import WorktreeContextMenu from '@/components/sidebar/WorktreeContextMenu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { isPortaledRowMenuClick, isRowActivationKey } from '@/lib/list-row-interaction'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { getWorktreeLineageGroupKey } from '../../../../../shared/sidebar-list/group-keys'
import { WorktreeLinksPrefetch } from '../activity-card/worktree-links'
import { WorktreeLinkStrip } from '../activity-card/WorktreeLinkStrip'
import { ActivityMachineChip } from '../activity-machines/ActivityMachineChip'
import { activityGroupMachineRows } from '../activity-machines/use-activity-machine-chips'
import { pilotStore } from '../store'
import { MergedWorktreeDeleteButton } from './MergedWorktreeDeleteButton'
import { setActivityInactiveExpanded, useActivityInactiveExpanded } from './activity-tabs-setting'
import {
  activityTabsGroupCount,
  childGroups,
  groupRows,
  INACTIVE_WORKTREES_GROUP_KEY
} from './activity-tabs-rows'
import { NestGuides } from './ActivityTabsNest'
import { NewAgentMenu } from './NewAgentMenu'
import { openActivityWorktree } from './open-activity-worktree'
import { useWorktreeGroupNestDepth } from './worktree-nest-parent'
import {
  HiddenUnreadBell,
  hidesUnread,
  WorktreeChildrenChip,
  WorktreeFoldButton
} from './WorktreeHeaderFolds'
import { WorktreeTitle } from './WorktreeTitle'

const WORKTREE_GROUP = 'worktree:'

type HeaderProps = {
  group: ActivityThreadGroup
  // Upstream's collapse, which folds a worktree's own sessions (Pilot keeps the set: WorktreeFoldCollapseProvider).
  // Inactive keeps its own fold.
  collapsed?: boolean
  onToggle?: () => void
  // Upstream's header, kept for every other group and while Pilot isn't attached.
  children: ReactNode
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="rounded-full border border-border/80 bg-muted/80 px-1.5 py-0.5 text-3xs font-semibold tabular-nums leading-none text-foreground/80 shadow-xs">
      {count}
    </span>
  )
}

function PinButton({ worktreeId, pinned }: { worktreeId: string; pinned: boolean }) {
  const label = pinned ? 'Unpin worktree' : 'Pin worktree'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pinned}
          onClick={(event) => {
            event.stopPropagation()
            const store = useAppStore.getState()
            const worktree = store.getKnownWorktreeById(worktreeId)
            if (worktree) {
              store.setWorktreesPinnedAndReveal([worktree], !pinned)
            }
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
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

// Grouped by worktree, the worktrees with no session, folded until opened. The whole header folds.
function InactiveHeader({ group }: { group: ActivityThreadGroup }) {
  const expanded = useActivityInactiveExpanded()
  const toggle = () => setActivityInactiveExpanded(!expanded)
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={expanded ? 'Hide inactive worktrees' : 'Show inactive worktrees'}
      onClick={toggle}
      onKeyDown={(event) => {
        if (isRowActivationKey(event)) {
          event.preventDefault()
          toggle()
        }
      }}
      className="flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <ChevronDown
        className={cn(
          'size-3.5 shrink-0 transition-transform duration-150',
          !expanded && '-rotate-90'
        )}
      />
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{group.label}</span>
      <CountBadge count={groupRows(group).length} />
    </div>
  )
}

// A worktree's sessions and tabs, its child worktrees' included.
function sessionCount(group: ActivityThreadGroup): number {
  return childGroups(group).reduce(
    (count, child) => count + sessionCount(child),
    group.threads.length + activityTabsGroupCount(group)
  )
}

// A fold toggle that runs once, however often a launch calls it.
function once(toggle: () => void): () => void {
  let done = false
  return () => {
    if (!done) {
      done = true
      toggle()
    }
  }
}

function openWorktree(worktreeId: string): void {
  const worktree = useAppStore.getState().getKnownWorktreeById(worktreeId)
  if (worktree) {
    openActivityWorktree(worktree)
  }
}

// pilot-hook: activity-tabs-group-header. A worktree group's header reads as a title over its
// sessions, not as one more caption: the worktree in row type, its project beside it, New agent
// and the Workspaces sidebar's pin (a pinned worktree always shows in Activity, first). Clicking it
// opens the worktree and a right-click gives its menu, as in Projects. Its folder icon folds the
// worktree's own sessions (a chevron on hover and while folded), so every icon still sits on the
// guide line. Under the name, chips carry the worktree's MR, Linear issue, git state (commits to
// push, uncommitted changes; a click pushes), live ports and, with child worktrees, Projects' own
// "N children" fold, which hides them apart from the sessions. A bell shows while a fold hides an
// unread session. It fetches the MR and issue once, for those chips and its Delete once the MR is
// merged. A child worktree's header sits on its parent's guide line, without the project its
// parent already names.
export function ActivityTabsGroupHeader({
  group,
  collapsed = false,
  onToggle,
  children
}: HeaderProps): ReactNode {
  const worktreeId = group.key.startsWith(WORKTREE_GROUP)
    ? group.key.slice(WORKTREE_GROUP.length)
    : null
  const worktree = useAppStore((s) => (worktreeId ? s.getKnownWorktreeById(worktreeId) : undefined))
  const repo = useAppStore((s) => s.repos.find((r) => r.id === worktree?.repoId) ?? null)
  const depth = useWorktreeGroupNestDepth(group.key)
  const project = depth === 0 ? (repo?.displayName ?? null) : null
  const pinned = worktree?.isPinned === true
  const childrenFolded = useAppStore((s) =>
    worktree ? s.collapsedGroups.has(getWorktreeLineageGroupKey(worktree)) : false
  )
  if (pilotStore() && group.key === INACTIVE_WORKTREES_GROUP_KEY) {
    return <InactiveHeader group={group} />
  }
  if (!pilotStore() || !worktreeId) {
    return children
  }
  const count = sessionCount(group)
  const childCount = childGroups(group).length
  // Why: the header stands in for a recent worktree's row, so it names that row's machine.
  const [machineRow] = activityGroupMachineRows(group)
  const header = (
    <div
      role="button"
      tabIndex={0}
      onClick={(event) => {
        // The New agent menu's pick bubbles here through its portal; it opens its own tab.
        if (!isPortaledRowMenuClick(event)) {
          openWorktree(worktreeId)
        }
      }}
      onKeyDown={(event) => {
        if (isRowActivationKey(event)) {
          event.preventDefault()
          openWorktree(worktreeId)
        }
      }}
      className="group flex cursor-pointer select-none flex-col rounded-md px-1.5 text-foreground transition-colors hover:bg-accent/60"
    >
      <div className="flex h-8 min-w-0 items-center gap-1.5">
        {worktree ? <WorktreeLinksPrefetch worktree={worktree} repo={repo} /> : null}
        {onToggle ? (
          <WorktreeFoldButton collapsed={collapsed} onToggle={onToggle} />
        ) : (
          <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        {machineRow ? (
          <ActivityMachineChip worktree={machineRow.worktree} repo={machineRow.repo} />
        ) : null}
        <WorktreeTitle name={group.label} project={project} nameClassName="font-semibold" />
        {/* A folded worktree unfolds for the session started from it. */}
        <NewAgentMenu
          worktreeId={worktreeId}
          onPick={collapsed && onToggle ? once(onToggle) : undefined}
        />
        <PinButton worktreeId={worktreeId} pinned={pinned} />
        {worktree ? <MergedWorktreeDeleteButton worktree={worktree} repo={repo} /> : null}
        {hidesUnread(group, collapsed, childrenFolded) ? <HiddenUnreadBell /> : null}
        <CountBadge count={count} />
      </div>
      {/* Under the name: the folder icon's width plus the gap. */}
      {worktree ? (
        <WorktreeLinkStrip worktree={worktree} repo={repo} className="pb-1.5 pl-5">
          {childCount > 0 ? <WorktreeChildrenChip worktree={worktree} count={childCount} /> : null}
        </WorktreeLinkStrip>
      ) : null}
    </div>
  )
  return (
    <NestGuides depth={depth} header>
      {worktree ? <WorktreeContextMenu worktree={worktree}>{header}</WorktreeContextMenu> : header}
    </NestGuides>
  )
}
