import { describe, expect, it } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../../shared/constants'
import type { Worktree } from '../../../../../shared/worktree/types'
import type { ActivityScopeFilter } from '@/components/activity/activity-scope-filter'
import {
  makeRepo,
  makeWorktreeWithId
} from '@/components/activity/ActivityPrototypePage-test-fixtures'
import {
  buildRecentWorktreeItems,
  RECENT_WORKTREE_WINDOW_MS,
  worktreeRowKey
} from './recent-worktree-items'

const NOW = 10 * RECENT_WORKTREE_WINDOW_MS
const SCOPE: ActivityScopeFilter = {
  visibleHostIds: null,
  filterRepoIds: [],
  defaultHostId: 'local',
  hideWorkspacesFromOtherDevices: false,
  pairedDeviceIdsByEnvironment: new Map(),
  hideAutomationGeneratedWorkspaces: false,
  hideCliCreatedWorkspaces: false
}

function worktree(id: string, ageMs: number, overrides: Partial<Worktree> = {}): Worktree {
  return { ...makeWorktreeWithId(id), lastActivityAt: NOW - ageMs, ...overrides }
}

type BuildOpts = { listed?: Worktree[]; query?: string; scope?: Partial<ActivityScopeFilter> }

function build(worktrees: Worktree[], opts: BuildOpts = {}) {
  return buildRecentWorktreeItems({
    worktrees,
    listed: new Set((opts.listed ?? []).map(worktreeRowKey)),
    openTabCount: (id) => (id === 'tabs' ? 2 : 0),
    now: NOW,
    ctx: {
      resolveRepo: () => makeRepo(),
      scope: { ...SCOPE, ...opts.scope },
      query: opts.query ?? ''
    }
  }).map((item) => [item.worktree.id, item.openTabCount])
}

describe('buildRecentWorktreeItems', () => {
  const recent = worktree('recent', 60_000)
  type Case = [string, Worktree[], BuildOpts, [string, number][]]
  it.each<Case>([
    [
      'active within the window, newest first',
      [worktree('older', 7_200_000), recent],
      {},
      [
        ['recent', 0],
        ['older', 0]
      ]
    ],
    ['carries its open tab count', [worktree('tabs', 1)], {}, [['tabs', 2]]],
    [
      'not active for longer than the window',
      [worktree('stale', RECENT_WORKTREE_WINDOW_MS + 1)],
      {},
      []
    ],
    ['archived', [worktree('archived', 1, { isArchived: true })], {}, []],
    ['the floating workspace', [worktree(FLOATING_TERMINAL_WORKTREE_ID, 1)], {}, []],
    ['already has a row in Activity', [recent], { listed: [recent] }, []],
    ['matched by branch', [recent], { query: 'FEAT' }, [['recent', 0]]],
    ['not matched by the search', [recent], { query: 'nothing' }, []],
    ['outside the project filter', [recent], { scope: { filterRepoIds: ['other'] } }, []]
  ])('%s', (_name, worktrees, opts, expected) => {
    expect(build(worktrees, opts)).toEqual(expected)
  })
})
