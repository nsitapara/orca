import type React from 'react'
import { ChevronDown, Workflow } from 'lucide-react'
import { activityThreadStatusId } from '@/components/activity/activity-thread-presentation'
import type { ActivityThreadGroup } from '@/components/activity/activity-thread-types'
import { AgentStateDot } from '@/components/AgentStateDot'
import { FilledBellIcon } from '@/components/sidebar/workspace-card/identity/worktree-card-glyphs'
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
 * The header's leading chevron, which folds the worktree's own sessions. It always shows, and nothing
 * takes its place on hover, so every header's chevron stays on the guide line.
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
          className="flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <ChevronDown
            className={cn(
              'size-3.5 transition-transform duration-150 motion-reduce:transition-none',
              collapsed && '-rotate-90'
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

// What a fold can hide that is worth a mark on the header, most pressing first.
const FOLDED_STATES = ['blocked', 'waiting', 'working'] as const
type FoldedState = (typeof FOLDED_STATES)[number]

function hiddenThreads(
  group: ActivityThreadGroup,
  collapsed: boolean,
  childrenFolded: boolean
): ActivityThreadGroup['threads'] {
  const own = collapsed ? group.threads : []
  const below = childrenFolded
    ? childGroups(group).flatMap((child) => hiddenThreads(child, true, true))
    : []
  return [...own, ...below]
}

/** The state a fold hides: an agent waiting on you first, else one working; null when neither. */
export function foldedAgentState(
  group: ActivityThreadGroup,
  collapsed: boolean,
  childrenFolded: boolean
): FoldedState | null {
  const states = new Set<string>(
    hiddenThreads(group, collapsed, childrenFolded).map(activityThreadStatusId)
  )
  return FOLDED_STATES.find((state) => states.has(state)) ?? null
}

/** The session rows' state dot, on a header whose fold hides a working or waiting agent. */
export function FoldedAgentState({ state }: { state: FoldedState }): React.JSX.Element {
  return (
    <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
      <AgentStateDot state={state} size="sm" />
    </span>
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
