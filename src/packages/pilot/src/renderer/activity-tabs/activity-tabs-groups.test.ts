import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../../../shared/repo-types'
import { buildActivityThreadGroups } from '@/components/activity/activity-thread-grouping'
import type { ActivityGroupBy, AgentPaneThread } from '@/components/activity/activity-thread-types'
import {
  buildActivityVirtualItems,
  getActivityVirtualItemKey
} from '@/components/activity/activity-thread-virtual-items'
import {
  makeRepo,
  makeTab,
  makeWorktreeWithId
} from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { mergeRowsIntoGroups } from './activity-tabs-groups'
import {
  activityTabsGroupCount,
  activityTabsGroupRows,
  withActivityTabsCount,
  type ActivityTabsRow
} from './activity-tabs-rows'
import type { WorkspaceTabItem } from './workspace-tab-items'

const agent: AgentPaneThread = {
  paneKey: 'pane-1',
  tab: makeTab(),
  worktree: makeWorktreeWithId('wt-a'),
  repo: makeRepo(),
  currentAgentState: null,
  currentAgentEntry: null,
  latestEvent: null,
  latestTimestamp: 1,
  agentType: 'claude',
  unread: false,
  paneTitle: 'Claude',
  responsePreview: '',
  events: []
}

function tabItem(id: string, worktreeId: string, repo: Repo | null): WorkspaceTabItem {
  return {
    key: id,
    label: id,
    worktree: makeWorktreeWithId(worktreeId),
    repo,
    tab: {
      id,
      entityId: id,
      worktreeId,
      groupId: 'g',
      contentType: 'terminal',
      label: id,
      customLabel: null,
      color: null,
      sortOrder: 0,
      createdAt: 1
    }
  }
}

// One agent in wt-a; a tab in wt-a (repo-1), one in wt-b (no repo), and a recent worktree wt-c (repo-1).
const ROWS: ActivityTabsRow[] = [
  { kind: 'tab', tab: tabItem('a-tab', 'wt-a', makeRepo()) },
  { kind: 'tab', tab: tabItem('b-tab', 'wt-b', null) },
  {
    kind: 'recent-worktree',
    recent: {
      key: 'c-key',
      worktree: makeWorktreeWithId('wt-c'),
      repo: makeRepo(),
      openTabCount: 0
    }
  }
]

function merged(groupBy: ActivityGroupBy) {
  return mergeRowsIntoGroups(buildActivityThreadGroups([agent], groupBy), ROWS, groupBy)
}

describe('mergeRowsIntoGroups', () => {
  it.each([
    {
      groupBy: 'status',
      groups: [
        ['done', 1, 0, 0],
        ['pilot:open-tabs', 0, 2, 2],
        ['pilot:recent-worktrees', 0, 0, 1]
      ]
    },
    {
      groupBy: 'agent',
      groups: [
        ['agent:claude', 1, 0, 0],
        ['pilot:open-tabs', 0, 2, 2],
        ['pilot:recent-worktrees', 0, 0, 1]
      ]
    },
    {
      groupBy: 'worktree',
      groups: [
        ['worktree:wt-a', 1, 1, 1],
        ['worktree:wt-b', 0, 1, 1],
        ['worktree:wt-c', 0, 0, 1]
      ]
    },
    {
      groupBy: 'project',
      groups: [
        ['project:repo-1', 1, 1, 2],
        ['project:unknown', 0, 1, 1]
      ]
    },
    { groupBy: 'none', groups: [['all', 1, 2, 3]] }
  ] as const)(
    'groupBy $groupBy → [key, agents, counted tabs, Pilot rows] $groups',
    ({ groupBy, groups }) => {
      expect(
        merged(groupBy).map((group) => [
          group.key,
          group.threads.length,
          activityTabsGroupCount(group),
          activityTabsGroupRows(group).length
        ])
      ).toEqual(groups)
    }
  )

  it('lists each group’s Pilot rows after its agents, collapses them with it, and counts them', () => {
    const groups = merged('worktree')
    const keys = (collapsed: string[]) =>
      buildActivityVirtualItems({
        groups,
        groupBy: 'worktree',
        collapsedGroupKeys: new Set(collapsed)
      }).map(getActivityVirtualItemKey)
    expect(keys([])).toEqual([
      'h:worktree:wt-a',
      't:pane-1',
      'w:a-tab',
      'h:worktree:wt-b',
      'w:b-tab',
      'h:worktree:wt-c',
      'r:c-key'
    ])
    expect(keys(['worktree:wt-a'])).toEqual([
      'h:worktree:wt-a',
      'h:worktree:wt-b',
      'w:b-tab',
      'h:worktree:wt-c',
      'r:c-key'
    ])
    expect(withActivityTabsCount(1, groups)).toBe(4)
  })
})
