import { describe, expect, it } from 'vitest'
import type { ClientHostedBrowserRow } from '../../../../../shared/client-hosted-browser-rows'
import type { Tab } from '../../../../../shared/tab-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import type { ActivityScopeFilter } from '@/components/activity/activity-scope-filter'
import { makeRepo, makeWorktree } from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { agentTabKey, buildWorktreeTabItems, type WorktreeTabsContext } from './workspace-tab-items'

const SCOPE: ActivityScopeFilter = {
  visibleHostIds: null,
  filterRepoIds: [],
  defaultHostId: 'local',
  hideWorkspacesFromOtherDevices: false,
  pairedDeviceIdsByEnvironment: new Map(),
  hideAutomationGeneratedWorkspaces: false,
  hideCliCreatedWorkspaces: false
}

function tab(id: string, contentType: Tab['contentType']): Tab {
  return {
    id,
    entityId: id,
    worktreeId: 'wt-1',
    groupId: 'g',
    contentType,
    label: id,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

function labels(
  tabs: Tab[],
  overrides: Partial<WorktreeTabsContext> = {},
  extra: { worktree?: Worktree; clientRows?: ClientHostedBrowserRow[] } = {}
): string[] {
  const worktree = extra.worktree ?? makeWorktree()
  const ctx: WorktreeTabsContext = {
    getKnownWorktreeById: (id) => (id === worktree.id ? worktree : undefined),
    resolveRepo: () => makeRepo(),
    ambiguous: new Set(),
    scope: SCOPE,
    agentTabKeys: new Set(),
    query: '',
    generatedTitlesEnabled: false,
    ...overrides
  }
  const groups = [
    {
      id: 'g',
      worktreeId: worktree.id,
      activeTabId: null,
      tabOrder: tabs.map((t) => t.id).toReversed()
    }
  ]
  return buildWorktreeTabItems(
    worktree.id,
    { tabs, groups, clientRows: extra.clientRows ?? [] },
    ctx
  ).map((item) => item.label)
}

describe('buildWorktreeTabItems', () => {
  it('lists every tab kind in the group tab order', () => {
    const kinds = ['terminal', 'agent-session', 'browser', 'simulator', 'editor', 'diff'] as const
    expect(labels(kinds.map((kind) => tab(kind, kind)))).toEqual([...kinds].toReversed())
  })

  it('skips a terminal Activity lists as an agent but keeps a browser sharing its id', () => {
    const agentTabKeys = new Set([agentTabKey(makeWorktree(), 'shell')])
    const browser = { ...tab('docs', 'browser'), entityId: 'shell' }
    expect(labels([tab('shell', 'terminal'), browser], { agentTabKeys })).toEqual(['docs'])
  })

  it.each([
    { name: 'search query', overrides: { query: 'BUILD' }, expected: ['build'] },
    {
      name: 'host scope',
      overrides: { scope: { ...SCOPE, visibleHostIds: ['ssh:other'] } },
      expected: []
    },
    {
      name: 'project scope',
      overrides: { scope: { ...SCOPE, filterRepoIds: ['other'] } },
      expected: []
    }
  ] satisfies { name: string; overrides: Partial<WorktreeTabsContext>; expected: string[] }[])(
    'applies the $name',
    ({ overrides, expected }) => {
      expect(labels([tab('docs', 'browser'), tab('build', 'terminal')], overrides)).toEqual(
        expected
      )
    }
  )

  it('hides CLI-created workspaces when Activity does', () => {
    const worktree: Worktree = {
      ...makeWorktree(),
      cliProvenance: { kind: 'created-by-cli', createdAt: 1 }
    }
    const scope = { ...SCOPE, hideCliCreatedWorkspaces: true }
    expect(labels([tab('shell', 'terminal')], { scope }, { worktree })).toEqual([])
  })

  it('lists a native page of a remote workspace as a browser row', () => {
    const row: ClientHostedBrowserRow = {
      worktreeId: 'wt-1',
      browserPageId: 'page',
      title: 'Docs',
      url: 'http://localhost:3000',
      loading: false,
      browserHostClientId: 'device',
      hostDeviceName: 'Laptop',
      hostAbsent: false
    }
    expect(labels([tab('shell', 'terminal')], {}, { clientRows: [row] })).toEqual(['shell', 'Docs'])
  })
})
