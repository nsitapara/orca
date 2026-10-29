import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../../../shared/repo-types'
import { buildActivityThreadGroups } from '@/components/activity/activity-thread-grouping'
import type {
  ActivityGroupBy,
  ActivityThreadGroup,
  AgentPaneThread
} from '@/components/activity/activity-thread-types'
import {
  buildActivityVirtualItems,
  getActivityVirtualItemKey
} from '@/components/activity/activity-thread-virtual-items'
import {
  makeRepo,
  makeTab,
  makeTabWithIds,
  makeWorktreeWithId
} from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { mergeRowsIntoGroups } from './activity-tabs-groups'
import {
  activityTabsGroupCount,
  activityTabsGroupRows,
  childGroups,
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
      pinned: false
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
        ['pilot:inactive-worktrees', 0, 0, 0]
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

  it('lists each group’s Pilot rows after its agents (a worktree’s header stands in for its recent row), collapses them with it, and counts them, folded ones included', () => {
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
      'h:pilot:inactive-worktrees'
    ])
    expect(keys(['worktree:wt-a'])).toEqual([
      'h:worktree:wt-a',
      'h:worktree:wt-b',
      'w:b-tab',
      'h:pilot:inactive-worktrees'
    ])
    expect(withActivityTabsCount(1, groups)).toBe(4)
  })
  it('puts pinned worktrees’ groups first, and a pinned worktree’s row under Pinned', () => {
    const groupKeys = (groupBy: ActivityGroupBy, rows: ActivityTabsRow[], pinned = ['wt-c']) =>
      mergeRowsIntoGroups(buildActivityThreadGroups([agent], groupBy), rows, groupBy, {
        pinnedWorktreeIds: pinned
      }).map((group) => group.key)
    expect(groupKeys('worktree', ROWS, ['wt-b'])).toEqual([
      'worktree:wt-b',
      'worktree:wt-a',
      'pilot:inactive-worktrees'
    ])
    expect(groupKeys('worktree', [])).toEqual(['worktree:wt-a'])
    const pinnedRow: ActivityTabsRow = {
      kind: 'recent-worktree',
      recent: {
        key: 'c-key',
        worktree: makeWorktreeWithId('wt-c'),
        repo: makeRepo(),
        pinned: true
      }
    }
    expect(groupKeys('status', [pinnedRow])).toEqual(['done', 'pilot:pinned-worktrees'])
  })
  it('orders worktree groups by pin and name only, whatever order upstream gave them', () => {
    const group = (id: string) => ({ key: `worktree:${id}`, label: id, threads: [] })
    const upstream = [group('wt-z'), group('WT-m'), group('wt-a')]
    const keys = (groupBy: ActivityGroupBy, pinned: string[]) =>
      mergeRowsIntoGroups(upstream, [], groupBy, { pinnedWorktreeIds: pinned }).map((g) => g.key)
    expect(keys('worktree', [])).toEqual(['worktree:wt-a', 'worktree:WT-m', 'worktree:wt-z'])
    expect(keys('worktree', ['wt-z'])).toEqual(['worktree:wt-z', 'worktree:wt-a', 'worktree:WT-m'])
    expect(keys('status', ['wt-z'])).toEqual(['worktree:wt-z', 'worktree:WT-m', 'worktree:wt-a'])
  })

  // Why: worktrees with no session sat between active ones; under Inactive they keep their order (pinned, then name).
  it.each([
    { inactiveExpanded: false, rows: [] },
    { inactiveExpanded: true, rows: ['r:m-key', 'r:b-key'] }
  ])(
    'grouped by worktree, worktrees with no session go in order under Inactive at the end (expanded: $inactiveExpanded)',
    ({ inactiveExpanded, rows }) => {
      const recent = (id: string, pinned: boolean): ActivityTabsRow => ({
        kind: 'recent-worktree',
        recent: { key: `${id.slice(3)}-key`, worktree: makeWorktreeWithId(id), repo: null, pinned }
      })
      const groups = mergeRowsIntoGroups(
        buildActivityThreadGroups([agent], 'worktree'),
        [
          { kind: 'tab', tab: tabItem('z-tab', 'wt-z', null) },
          recent('wt-b', false),
          recent('wt-m', true)
        ],
        'worktree',
        { pinnedWorktreeIds: ['wt-m', 'wt-z'], inactiveExpanded }
      )
      const keys = buildActivityVirtualItems({
        groups,
        groupBy: 'worktree',
        collapsedGroupKeys: new Set()
      }).map(getActivityVirtualItemKey)
      expect(keys).toEqual([
        'h:worktree:wt-z',
        'w:z-tab',
        'h:worktree:wt-a',
        't:pane-1',
        'h:pilot:inactive-worktrees',
        ...rows
      ])
      expect(withActivityTabsCount(1, groups)).toBe(4)
    }
  )

  // Why: a Pilot run's throwaway (a child in Orca's lineage) read as the repo's own checkout, away from its branch.
  it.each([
    {
      name: 'a parent with a session',
      threads: ['wt-a', 'wt-kid'],
      rows: [],
      keys: ['h:worktree:wt-a', 't:pane-wt-a', 'h:worktree:wt-kid', 't:pane-wt-kid'],
      children: [['worktree:wt-a', ['worktree:wt-kid']]]
    },
    {
      name: 'a parent with no session leaves Inactive',
      threads: ['wt-kid'],
      rows: ['wt-a', 'wt-b'],
      keys: ['h:worktree:wt-a', 'h:worktree:wt-kid', 't:pane-wt-kid', 'h:pilot:inactive-worktrees'],
      children: [['worktree:wt-a', ['worktree:wt-kid']]]
    },
    {
      name: 'a parent with no row gets a header',
      threads: ['wt-kid'],
      rows: [],
      keys: ['h:worktree:wt-a', 'h:worktree:wt-kid', 't:pane-wt-kid'],
      children: [['worktree:wt-a', ['worktree:wt-kid']]]
    },
    {
      name: 'a child with no session stays under Inactive',
      threads: ['wt-a'],
      rows: ['wt-kid'],
      keys: ['h:worktree:wt-a', 't:pane-wt-a', 'h:pilot:inactive-worktrees'],
      children: [['worktree:wt-a', []]]
    },
    {
      name: 'a parent whose children are folded lists none of its subtree',
      threads: ['wt-a', 'wt-kid', 'wt-grand'],
      rows: [],
      folded: ['wt-a'],
      keys: ['h:worktree:wt-a', 't:pane-wt-a'],
      children: [['worktree:wt-a', ['worktree:wt-kid']]]
    },
    {
      name: 'a folded parent still lists the way to the current worktree',
      threads: ['wt-a', 'wt-kid', 'wt-sib', 'wt-grand'],
      rows: [],
      folded: ['wt-a'],
      current: 'wt-grand',
      keys: [
        'h:worktree:wt-a',
        't:pane-wt-a',
        'h:worktree:wt-kid',
        't:pane-wt-kid',
        'h:worktree:wt-grand',
        't:pane-wt-grand'
      ],
      children: [['worktree:wt-a', ['worktree:wt-kid', 'worktree:wt-sib']]]
    },
    {
      name: 'a folded child still carries its own children',
      threads: ['wt-a', 'wt-kid', 'wt-grand'],
      rows: [],
      folded: ['wt-kid'],
      keys: ['h:worktree:wt-a', 't:pane-wt-a', 'h:worktree:wt-kid', 't:pane-wt-kid'],
      children: [
        ['worktree:wt-a', ['worktree:wt-kid']],
        ['worktree:wt-kid', ['worktree:wt-grand']]
      ]
    }
  ])(
    'grouped by worktree, a child worktree’s group follows its parent’s: $name',
    ({ threads, rows, keys, children, folded = [], current = null }) => {
      const thread = (worktreeId: string): AgentPaneThread => ({
        ...agent,
        paneKey: `pane-${worktreeId}`,
        tab: makeTabWithIds(`tab-${worktreeId}`, worktreeId),
        worktree: makeWorktreeWithId(worktreeId)
      })
      const recent = (id: string): ActivityTabsRow => ({
        kind: 'recent-worktree',
        recent: { key: `${id}-key`, worktree: makeWorktreeWithId(id), repo: null, pinned: false }
      })
      const groups = mergeRowsIntoGroups(
        buildActivityThreadGroups(threads.map(thread), 'worktree'),
        rows.map(recent),
        'worktree',
        {
          parentOf: (id) => {
            const parent = { 'wt-kid': 'wt-a', 'wt-sib': 'wt-a', 'wt-grand': 'wt-kid' }[id]
            return parent ? { id: parent, label: parent } : null
          },
          childrenFolded: (id) => folded.includes(id),
          currentWorktreeId: current
        }
      )
      expect(
        buildActivityVirtualItems({
          groups,
          groupBy: 'worktree',
          collapsedGroupKeys: new Set()
        }).map(getActivityVirtualItemKey)
      ).toEqual(keys)
      // A folded group's subtree stays attached, so its header counts what the fold hides.
      const attached = (
        key: unknown,
        list: readonly ActivityThreadGroup[] = groups
      ): ActivityThreadGroup | undefined =>
        list
          .map((group) => (group.key === key ? group : attached(key, childGroups(group))))
          .find(Boolean)
      expect(
        children.map(([key]) => [key, childGroups(attached(key)!).map((child) => child.key)])
      ).toEqual(children)
    }
  )

  // Why: a folded child's tabs aren't listed, but "No agent activity" mustn't show under a header counting them.
  it('counts a folded child worktree’s tabs toward the list, once each', () => {
    const parentOf = (id: string) => (id === 'wt-kid' ? { id: 'wt-a', label: 'wt-a' } : null)
    const rows: ActivityTabsRow[] = [{ kind: 'tab', tab: tabItem('kid-tab', 'wt-kid', null) }]
    const merge = (folded: boolean) =>
      mergeRowsIntoGroups([], rows, 'worktree', { parentOf, childrenFolded: () => folded })
    expect(merge(true).map((group) => group.key)).toEqual(['worktree:wt-a'])
    expect(withActivityTabsCount(0, merge(true))).toBe(1)
    expect(withActivityTabsCount(0, merge(false))).toBe(1)
  })

  it('nests only when grouped by worktree', () => {
    const groups = mergeRowsIntoGroups(
      buildActivityThreadGroups([agent], 'project'),
      [],
      'project',
      {
        parentOf: () => ({ id: 'wt-z', label: 'wt-z' })
      }
    )
    expect(groups.map((group) => [group.key, childGroups(group).length])).toEqual([
      ['project:repo-1', 0]
    ])
  })
})
