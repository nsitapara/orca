import type {
  ActivityGroupBy,
  ActivityThreadGroup
} from '@/components/activity/activity-thread-types'
import { translate } from '@/i18n/i18n'
import {
  childGroups,
  groupRows,
  INACTIVE_WORKTREES_GROUP_KEY,
  withChildGroups,
  withGroupRows,
  type ActivityTabsRow
} from './activity-tabs-rows'
import { compareWorktreeNames } from './workspace-tab-items'
import type { ChildrenFoldedOf } from './activity-worktree-folds'
import type { WorktreeParentOf } from './worktree-nest-parent'

export const OPEN_TABS_GROUP_KEY = 'pilot:open-tabs'
export const RECENT_WORKTREES_GROUP_KEY = 'pilot:recent-worktrees'
export const PINNED_WORKTREES_GROUP_KEY = 'pilot:pinned-worktrees'
const WORKTREE_GROUP = 'worktree:'

// Mirrors getActivityThreadGroup, which takes an agent thread. A Pilot row has no status or agent
// type, so those groupings put it under Open tabs, Pinned or Recently active.
function rowGroup(row: ActivityTabsRow, groupBy: ActivityGroupBy): { key: string; label: string } {
  const { worktree, repo } = row.kind === 'tab' ? row.tab : row.recent
  if (groupBy === 'none') {
    return { key: 'all', label: '' }
  }
  if (groupBy === 'project') {
    return repo
      ? { key: `project:${repo.id}`, label: repo.displayName }
      : {
          key: 'project:unknown',
          label: translate(
            'auto.components.activity.ActivityPrototypePage.5651b216c6',
            'Unknown project'
          )
        }
  }
  if (groupBy === 'worktree') {
    return { key: `${WORKTREE_GROUP}${worktree.id}`, label: worktree.displayName }
  }
  if (row.kind === 'tab') {
    return { key: OPEN_TABS_GROUP_KEY, label: 'Open tabs' }
  }
  return row.recent.pinned
    ? { key: PINNED_WORKTREES_GROUP_KEY, label: 'Pinned' }
    : { key: RECENT_WORKTREES_GROUP_KEY, label: 'Recently active' }
}

// Grouped by worktree, a group's place depends only on its pin and its name: pinned first, then by
// name. Upstream orders agents' groups by their latest activity, and selecting a worktree must never
// move it.
function worktreeOrder(
  groups: ActivityThreadGroup[],
  groupBy: ActivityGroupBy,
  pinnedWorktreeIds: readonly string[]
): ActivityThreadGroup[] {
  if (groupBy !== 'worktree') {
    return groups
  }
  const pinned = new Set(pinnedWorktreeIds.map((id) => `${WORKTREE_GROUP}${id}`))
  return [...groups].sort(
    (a, b) =>
      Number(pinned.has(b.key)) - Number(pinned.has(a.key)) ||
      compareWorktreeNames(a.label, b.label)
  )
}

export type MergeRowsOptions = {
  pinnedWorktreeIds?: readonly string[]
  // The Inactive section's fold; it starts folded.
  inactiveExpanded?: boolean
  // Grouped by worktree, the worktree each worktree's group nests under (worktree-nest-parent.ts).
  parentOf?: WorktreeParentOf
  // Grouped by worktree, whether a worktree's child worktrees are folded (activity-worktree-folds.ts).
  childrenFolded?: ChildrenFoldedOf
  // The worktree open in the workspace, which no fold hides.
  currentWorktreeId?: string | null
}

// A worktree group whose only row is its own header's: the worktree has no agent, no tab and no active child.
function isInactiveWorktreeGroup(group: ActivityThreadGroup): boolean {
  const rows = groupRows(group)
  return (
    group.key.startsWith(WORKTREE_GROUP) &&
    group.threads.length === 0 &&
    childGroups(group).length === 0 &&
    rows.length > 0 &&
    rows.every((row) => row.kind === 'recent-worktree')
  )
}

const NO_PARENT: WorktreeParentOf = () => null
const NONE_FOLDED: ChildrenFoldedOf = () => false

function worktreeIdOf(group: ActivityThreadGroup): string | null {
  return group.key.startsWith(WORKTREE_GROUP) ? group.key.slice(WORKTREE_GROUP.length) : null
}

// Grouped by worktree, an active worktree's group follows its parent's, a level in (a Pilot run's throwaway under the
// worktree it checked out). An ancestor with no session gets a header of its own, and leaves Inactive while a child runs.
// A worktree whose children are folded lists none of its subtree but the way down to the current worktree.
function nestChildGroups(
  groups: ActivityThreadGroup[],
  groupBy: ActivityGroupBy,
  parentOf: WorktreeParentOf,
  pinnedWorktreeIds: readonly string[],
  childrenFolded: ChildrenFoldedOf,
  currentWorktreeId: string | null
): ActivityThreadGroup[] {
  if (groupBy !== 'worktree') {
    return groups
  }
  const ancestorsOfActive = new Set<string>()
  for (const group of groups) {
    const id = worktreeIdOf(group)
    if (id === null || isInactiveWorktreeGroup(group)) {
      continue
    }
    for (let parent = parentOf(id); parent; parent = parentOf(parent.id)) {
      const key = `${WORKTREE_GROUP}${parent.id}`
      if (ancestorsOfActive.has(key)) {
        break
      }
      ancestorsOfActive.add(key)
    }
  }
  const known = new Set(groups.map((group) => group.key))
  const childrenByKey = new Map<string, ActivityThreadGroup[]>()
  const roots: ActivityThreadGroup[] = []
  const place = (group: ActivityThreadGroup): void => {
    const id = worktreeIdOf(group)
    const nests = !isInactiveWorktreeGroup(group) || ancestorsOfActive.has(group.key)
    const parent = id !== null && nests ? parentOf(id) : null
    if (!parent) {
      roots.push(group)
      return
    }
    const parentKey = `${WORKTREE_GROUP}${parent.id}`
    childrenByKey.set(parentKey, [...(childrenByKey.get(parentKey) ?? []), group])
    if (!known.has(parentKey)) {
      known.add(parentKey)
      place({ key: parentKey, label: parent.label, threads: [] })
    }
  }
  for (const group of groups) {
    place(group)
  }
  // Every group carries its whole subtree, so a header counts sessions its fold hides.
  const attach = (group: ActivityThreadGroup): ActivityThreadGroup => {
    const children = worktreeOrder(childrenByKey.get(group.key) ?? [], groupBy, pinnedWorktreeIds)
    return children.length > 0 ? withChildGroups(group, children.map(attach)) : group
  }
  const currentKey = currentWorktreeId === null ? null : `${WORKTREE_GROUP}${currentWorktreeId}`
  const holdsCurrent = (group: ActivityThreadGroup): boolean =>
    group.key === currentKey || childGroups(group).some(holdsCurrent)
  const listed: ActivityThreadGroup[] = []
  const list = (group: ActivityThreadGroup): void => {
    listed.push(group)
    const id = worktreeIdOf(group)
    if (id === null || !childrenFolded(id)) {
      childGroups(group).forEach(list)
    } else {
      childGroups(group).filter(holdsCurrent).forEach(list)
    }
  }
  worktreeOrder(roots, groupBy, pinnedWorktreeIds).map(attach).forEach(list)
  return listed
}

// Grouped by worktree, worktrees with no session move, in order, under one Inactive header at the end.
function inactiveLast(
  groups: ActivityThreadGroup[],
  groupBy: ActivityGroupBy,
  inactiveExpanded: boolean
): ActivityThreadGroup[] {
  if (groupBy !== 'worktree') {
    return groups
  }
  const inactive = groups.filter(isInactiveWorktreeGroup)
  if (inactive.length === 0) {
    return groups
  }
  const section = withGroupRows(
    { key: INACTIVE_WORKTREES_GROUP_KEY, label: 'Inactive', threads: [] },
    inactive.flatMap(groupRows),
    !inactiveExpanded
  )
  return [...groups.filter((group) => !isInactiveWorktreeGroup(group)), section]
}

/**
 * Puts each row in its Group by group, after the agents; groups with only Pilot rows go after the
 * rest. Grouped by worktree, groups go pinned first, then by name, a child worktree's right after its
 * parent's (the current worktree's even when folded), and those with no session go under Inactive at the end.
 */
export function mergeRowsIntoGroups(
  groups: ActivityThreadGroup[],
  rows: readonly ActivityTabsRow[],
  groupBy: ActivityGroupBy,
  {
    pinnedWorktreeIds = [],
    inactiveExpanded = false,
    parentOf = NO_PARENT,
    childrenFolded = NONE_FOLDED,
    currentWorktreeId = null
  }: MergeRowsOptions = {}
): ActivityThreadGroup[] {
  if (rows.length === 0) {
    return nestChildGroups(
      groups,
      groupBy,
      parentOf,
      pinnedWorktreeIds,
      childrenFolded,
      currentWorktreeId
    )
  }
  const pending = new Map<string, { label: string; rows: ActivityTabsRow[] }>()
  for (const row of rows) {
    const { key, label } = rowGroup(row, groupBy)
    const entry = pending.get(key)
    if (entry) {
      entry.rows.push(row)
    } else {
      pending.set(key, { label, rows: [row] })
    }
  }
  const merged = groups.map((group) => {
    const entry = pending.get(group.key)
    if (!entry) {
      return group
    }
    pending.delete(group.key)
    return withGroupRows(group, entry.rows)
  })
  for (const [key, entry] of pending) {
    merged.push(withGroupRows({ key, label: entry.label, threads: [] }, entry.rows))
  }
  return inactiveLast(
    nestChildGroups(
      merged,
      groupBy,
      parentOf,
      pinnedWorktreeIds,
      childrenFolded,
      currentWorktreeId
    ),
    groupBy,
    inactiveExpanded
  )
}
