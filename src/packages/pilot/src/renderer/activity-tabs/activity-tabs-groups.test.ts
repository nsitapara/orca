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
import { mergeTabsIntoGroups } from './activity-tabs-groups'
import { activityTabsGroupCount, withActivityTabsCount } from './activity-tabs-rows'
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

// One agent in wt-a; a tab in wt-a (repo-1) and one in wt-b (no repo).
const TABS = [tabItem('a-tab', 'wt-a', makeRepo()), tabItem('b-tab', 'wt-b', null)]

function merged(groupBy: ActivityGroupBy) {
  return mergeTabsIntoGroups(buildActivityThreadGroups([agent], groupBy), TABS, groupBy)
}

describe('mergeTabsIntoGroups', () => {
  it.each([
    {
      groupBy: 'status',
      groups: [
        ['done', 1, 0],
        ['pilot:open-tabs', 0, 2]
      ]
    },
    {
      groupBy: 'agent',
      groups: [
        ['agent:claude', 1, 0],
        ['pilot:open-tabs', 0, 2]
      ]
    },
    {
      groupBy: 'worktree',
      groups: [
        ['worktree:wt-a', 1, 1],
        ['worktree:wt-b', 0, 1]
      ]
    },
    {
      groupBy: 'project',
      groups: [
        ['project:repo-1', 1, 1],
        ['project:unknown', 0, 1]
      ]
    },
    { groupBy: 'none', groups: [['all', 1, 2]] }
  ] as const)('groupBy $groupBy → [key, agents, tabs] $groups', ({ groupBy, groups }) => {
    expect(
      merged(groupBy).map((group) => [
        group.key,
        group.threads.length,
        activityTabsGroupCount(group)
      ])
    ).toEqual(groups)
  })

  it('lists each group’s tabs after its agents, collapses them with it, and counts them', () => {
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
      'w:b-tab'
    ])
    expect(keys(['worktree:wt-a'])).toEqual(['h:worktree:wt-a', 'h:worktree:wt-b', 'w:b-tab'])
    expect(withActivityTabsCount(1, groups)).toBe(3)
  })
})
