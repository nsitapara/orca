import type { ReactNode } from 'react'
import { ChevronDown, Pin } from 'lucide-react'
import type { ActivityThreadGroup } from '@/components/activity/activity-thread-types'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import WorktreeContextMenu from '@/components/sidebar/workspace-actions/context-menu/WorktreeContextMenu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  isPortaledRowMenuClick,
  isRowActivationKey
} from '@/lib/list-interaction/list-row-interaction'
import { cn } from '@/lib/class-names'
import { useAppStore } from '@/store'
import { getWorktreeLineageGroupKey } from '../../../../../shared/sidebar-list/group-keys'
import { WorktreeLinksPrefetch } from '../activity-card/worktree-links'
import { useWorktreeStripLinks, WorktreeLinkStripView } from '../activity-card/WorktreeLinkStrip'
import { WorktreeBranchLine } from '../activity-card/WorktreeBranchLine'
import { linearIdOfBranch } from '../activity-card/linear-branch-issue'
import type { AgentDotState } from '@/components/AgentStateDot'
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
import '../sidebar/sidebar-selection.css'
import {
  FoldedAgentState,
  foldedAgentState,
  HiddenUnreadBell,
  hidesUnread,
  WorktreeChildrenChip,
  WorktreeFoldButton
} from './WorktreeHeaderFolds'
import { WorktreeNameTooltip } from './WorktreeNameTooltip'
import { WorktreeTitle } from './WorktreeTitle'
import {
  branchRepeatsHeader,
  titleWithoutIssueId,
  worktreeFolderName
} from './worktree-header-title'

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
            'flex size-5 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            pinned ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Pin className={cn('size-3', pinned && 'fill-current')} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

// The count and the pin always show. New agent takes the count's place, in the same slot, on hover,
// keyboard focus or its open menu, so nothing moves; touch screens always show it.
// Before them, what a fold hides: an unread session's bell and a working or waiting agent's dot.
function HeaderEnd({
  worktree,
  repo,
  pinned,
  bell,
  foldedState,
  count
}: {
  worktree: Worktree
  repo: Repo | null
  pinned: boolean
  bell: boolean
  foldedState: Extract<AgentDotState, 'blocked' | 'waiting' | 'working'> | null
  count: number
}) {
  return (
    <span className="flex h-[18px] shrink-0 items-center gap-1">
      <MergedWorktreeDeleteButton worktree={worktree} repo={repo} />
      {bell ? <HiddenUnreadBell /> : null}
      {foldedState ? <FoldedAgentState state={foldedState} /> : null}
      <span className="group/end relative flex h-full min-w-5 items-center justify-center">
        <span className="flex [@media(hover:none)]:invisible can-hover:group-hover:invisible group-focus-visible:invisible [[class~='group/end']:has(:focus-visible)_&]:invisible [[class~='group/end']:has([data-state=open])_&]:invisible">
          <CountBadge count={count} />
        </span>
        <span className="absolute inset-0 flex items-center justify-center can-hover:invisible can-hover:group-hover:visible group-focus-visible:visible [[class~='group/end']:has(:focus-visible)_&]:visible [[class~='group/end']:has([data-state=open])_&]:visible">
          <NewAgentMenu worktreeId={worktree.id} />
        </span>
      </span>
      <PinButton worktreeId={worktree.id} pinned={pinned} />
    </span>
  )
}

// Where a header has no fold, the chevron's width, so every title starts in one column.
function LeadSpacer() {
  return <span aria-hidden className="size-3.5 shrink-0" />
}

// Under the name the chips (Linear, git, MR, artifacts, ports, children, then the project) and, when it says more than
// they do, the branch. The name drops the Linear ID its chip shows, wraps to two lines, then loses words from its
// middle; hovering it gives the worktree's folder name to copy.
function WorktreeHeaderBody({
  worktree,
  repo,
  label,
  project,
  collapsed,
  onToggle,
  machine,
  end,
  childCount
}: {
  worktree: Worktree
  repo: Repo | null
  label: string
  project: string | null
  collapsed: boolean
  onToggle?: () => void
  machine: ReactNode
  end: ReactNode
  childCount: number
}) {
  const links = useWorktreeStripLinks(worktree, repo)
  const branch = (worktree.branch ?? '').replace(/^refs\/heads\//, '')
  // Why: a branch named for its ticket would show the chip's ID and the title's words a second time.
  // The branch's own ID stands in until Linear returns the issue, so the line never flashes in.
  const showBranch =
    branch.length > 0 &&
    !branchRepeatsHeader(branch, label, links.linear?.identifier ?? linearIdOfBranch(branch))
  const title = titleWithoutIssueId(label, links.linear?.identifier)
  return (
    <>
      <div className="flex min-w-0 items-start gap-1.5 py-[7px]">
        <WorktreeLinksPrefetch worktree={worktree} repo={repo} />
        <span className="flex h-[18px] shrink-0 items-center">
          {onToggle ? (
            <WorktreeFoldButton collapsed={collapsed} onToggle={onToggle} />
          ) : (
            <LeadSpacer />
          )}
        </span>
        {machine ? <span className="flex h-[18px] shrink-0 items-center">{machine}</span> : null}
        <WorktreeNameTooltip name={worktreeFolderName(worktree.path)} title={title}>
          <WorktreeTitle name={title} project={null} nameClassName="font-semibold" wrap />
        </WorktreeNameTooltip>
        {end}
      </div>
      {/* Under the name: the chevron's width plus the gap. */}
      <div className="flex min-w-0 flex-col gap-1 pb-1.5 pl-5">
        <WorktreeLinkStripView worktree={worktree} repo={repo} links={links} artifacts>
          {childCount > 0 ? <WorktreeChildrenChip worktree={worktree} count={childCount} /> : null}
          {/* The project leaves the title its whole line and ends every header's chip row alike. */}
          {project ? (
            <span
              className="ml-auto min-w-0 shrink truncate pl-1 text-2xs text-muted-foreground"
              title={project}
            >
              {project}
            </span>
          ) : null}
        </WorktreeLinkStripView>
        {showBranch ? <WorktreeBranchLine branch={branch} /> : null}
      </div>
    </>
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

function openWorktree(worktreeId: string): void {
  const worktree = useAppStore.getState().getKnownWorktreeById(worktreeId)
  if (worktree) {
    openActivityWorktree(worktree)
  }
}

// pilot-hook: activity-tabs-group-header. A worktree group's header reads as a title over its
// sessions, not as one more caption: the worktree in row type, its project beside it, New agent
// and the Workspaces sidebar's pin (a pinned worktree always shows in Activity, first). Clicking it
// opens the worktree and a right-click gives its menu, as in Projects. Its leading chevron folds the
// worktree's own sessions and always shows, as do its count and pin; New agent takes the count's
// place on hover, so nothing moves. Under the name, chips carry the worktree's MR, Linear issue, git state (commits to
// push, uncommitted changes; a click pushes), live ports and, with child worktrees, Projects' own
// "N children" fold, which hides them apart from the sessions. A bell shows while a fold hides an
// unread session, and a state dot while it hides a working or waiting agent. It fetches the MR and issue once, for those chips and its Delete once the MR is
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
  const selected = useAppStore((s) => worktreeId !== null && s.activeWorktreeId === worktreeId)
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
      aria-current={selected ? 'true' : undefined}
      data-pilot-worktree-header={worktreeId}
      data-pilot-selected-worktree={selected ? '' : undefined}
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
      {worktree ? (
        <WorktreeHeaderBody
          worktree={worktree}
          repo={repo}
          label={group.label}
          project={project}
          collapsed={collapsed}
          onToggle={onToggle}
          machine={
            machineRow ? (
              <ActivityMachineChip worktree={machineRow.worktree} repo={machineRow.repo} />
            ) : null
          }
          end={
            <HeaderEnd
              worktree={worktree}
              repo={repo}
              pinned={pinned}
              bell={hidesUnread(group, collapsed, childrenFolded)}
              foldedState={foldedAgentState(group, collapsed, childrenFolded)}
              count={count}
            />
          }
          childCount={childCount}
        />
      ) : (
        <div className="flex h-8 min-w-0 items-center gap-1.5">
          <LeadSpacer />
          <WorktreeTitle name={group.label} project={project} nameClassName="font-semibold" />
          <CountBadge count={count} />
        </div>
      )}
    </div>
  )
  return (
    <NestGuides depth={depth} header>
      {worktree ? <WorktreeContextMenu worktree={worktree}>{header}</WorktreeContextMenu> : header}
    </NestGuides>
  )
}
