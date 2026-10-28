import type React from 'react'
import { ChevronDown, FolderGit2, Workflow } from 'lucide-react'
import type { ActivityThreadGroup } from '@/components/activity/activity-thread-types'
import { FilledBellIcon } from '@/components/sidebar/WorktreeCardHelpers'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { getWorktreeLineageGroupKey } from '../../../../../shared/sidebar-list/group-keys'
import type { Worktree } from '../../../../../shared/worktree/types'
import { WORKTREE_CHIP_CLASS } from '../activity-card/worktree-chip-class'
import { childGroups } from './activity-tabs-rows'

// The header around these opens its worktree on click and Enter; these only fold.
const stopRowActivation = {
  onMouseDown: (event: React.MouseEvent) => event.stopPropagation(),
  onKeyDown: (event: React.KeyboardEvent) => event.stopPropagation()
}

/**
 * The header's folder icon, which folds the worktree's own sessions. Hovering the header shows the
 * chevron in its place, and a folded worktree keeps it, so every icon stays on the guide line.
 */
export function WorktreeFoldButton({
  collapsed,
  onToggle
}: {
  collapsed: boolean
  onToggle: () => void
}): React.JSX.Element {
  const label = collapsed ? 'Expand worktree' : 'Collapse worktree'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-expanded={!collapsed}
          {...stopRowActivation}
          onClick={(event) => {
            event.stopPropagation()
            onToggle()
          }}
          className="group/fold flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <FolderGit2
            className={cn(
              'size-3.5',
              collapsed ? 'hidden' : 'can-hover:group-hover:hidden group-focus-visible/fold:hidden'
            )}
          />
          <ChevronDown
            className={cn(
              'size-3.5 transition-transform duration-150 motion-reduce:transition-none',
              collapsed
                ? '-rotate-90'
                : 'hidden can-hover:group-hover:block group-focus-visible/fold:block'
            )}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

function childLabel(count: number, folded: boolean): string {
  if (count === 1) {
    return folded
      ? translate(
          'auto.components.sidebar.WorktreeList.20bebf9c7f',
          'Show {{value0}} child workspace',
          {
            value0: count
          }
        )
      : translate(
          'auto.components.sidebar.WorktreeList.e97297cb75',
          'Hide {{value0}} child workspace',
          {
            value0: count
          }
        )
  }
  return folded
    ? translate(
        'auto.components.sidebar.WorktreeList.c1f4a31623',
        'Show {{value0}} child workspaces',
        {
          value0: count
        }
      )
    : translate(
        'auto.components.sidebar.WorktreeList.0cd15956d4',
        'Hide {{value0}} child workspaces',
        {
          value0: count
        }
      )
}

/**
 * The Projects sidebar's "N children" chip, in the header's chip strip: it folds the worktree's child
 * worktrees, apart from its own sessions, and shares Projects' fold.
 */
export function WorktreeChildrenChip({
  worktree,
  count
}: {
  worktree: Worktree
  count: number
}): React.JSX.Element {
  const groupKey = getWorktreeLineageGroupKey(worktree)
  const folded = useAppStore((s) => s.collapsedGroups.has(groupKey))
  const label = childLabel(count, folded)
  const noun =
    count === 1
      ? translate('auto.components.sidebar.WorktreeList.0c6ee14f23', 'child')
      : translate('auto.components.sidebar.WorktreeList.045a8aed48', 'children')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-expanded={!folded}
          {...stopRowActivation}
          onClick={(event) => {
            event.stopPropagation()
            useAppStore.getState().toggleCollapsedGroup(groupKey)
          }}
          className={WORKTREE_CHIP_CLASS}
        >
          <Workflow className="size-3 shrink-0" />
          {count} {noun}
          <ChevronDown
            className={cn(
              'size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none',
              folded && '-rotate-90'
            )}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function anyUnread(group: ActivityThreadGroup): boolean {
  return group.threads.some((thread) => thread.unread) || childGroups(group).some(anyUnread)
}

/** Whether a fold hides an unread session: the worktree's own, or one anywhere under its folded children. */
export function hidesUnread(
  group: ActivityThreadGroup,
  collapsed: boolean,
  childrenFolded: boolean
): boolean {
  return (
    (collapsed && group.threads.some((thread) => thread.unread)) ||
    (childrenFolded && childGroups(group).some(anyUnread))
  )
}

/** The rows' unread bell, on a header whose fold hides an unread session. */
export function HiddenUnreadBell(): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label="Unread sessions folded"
          className="inline-flex size-3.5 shrink-0 items-center justify-center"
        >
          <FilledBellIcon className="size-3 text-annotation-highlight drop-shadow-sm" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">Unread sessions folded</TooltipContent>
    </Tooltip>
  )
}
