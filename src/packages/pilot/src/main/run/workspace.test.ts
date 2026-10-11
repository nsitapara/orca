import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { ItemFields } from '../../shared/api-types'
import { testDefinition } from '../../shared/definition/__fixtures__/definition'
import type { WorkspaceDef } from '../../shared/definition/types'
import type { WorktreeInfo } from '../fields/worktree-facts'
import { resolveWorkspace, runtimeWorkspaceDeps, type WorkspaceDeps } from './workspace'

const listed: WorktreeInfo[] = [
  { id: 'r::/repo', path: '/repo', branch: 'dev', head: 'h0', linkedLinearIssue: null },
  {
    id: 'r::/wt/memo-20261011',
    path: '/wt/memo-20261011',
    branch: 'nish/memo-20261011',
    head: 'h1',
    linkedLinearIssue: null
  }
]

function depsWith(list: WorktreeInfo[] | Error = listed): WorkspaceDeps & { created: unknown[] } {
  const created: unknown[] = []
  return {
    created,
    listWorktrees: async () => {
      if (list instanceof Error) {
        throw list
      }
      return list
    },
    createWorktree: async (req) => {
      created.push(req)
      return { id: `r::/wt/${req.name}`, path: `/wt/${req.name}` }
    }
  }
}

const request = (workspace: WorkspaceDef, fields: ItemFields) => ({
  definition: testDefinition({ id: 'm04', name: 'Remove manual memo', workspace }),
  runId: 'm04-1',
  label: '!1561 web-1493',
  fields: { 'repo.path': '/repo', 'run.date': '20261011', ...fields }
})
const newWorktree = (
  name: string,
  reuseExisting: boolean,
  setup: 'run' | 'skip' = 'skip'
): WorkspaceDef => ({
  kind: 'new_worktree',
  base: 'origin/dev',
  name,
  reuseExisting,
  setup
})

describe('resolveWorkspace', () => {
  it.each<[string, ItemFields, { selector: string; path: string; worktreeId: string | null }]>([
    [
      'by worktree id',
      { 'worktree.id': 'r::/wt/a', 'worktree.path': '/wt/a' },
      { selector: 'id:r::/wt/a', path: '/wt/a', worktreeId: 'r::/wt/a' }
    ],
    [
      'by path when the id is unknown',
      { 'worktree.id': null, 'worktree.path': '/wt/a' },
      { selector: 'path:/wt/a', path: '/wt/a', worktreeId: null }
    ]
  ])("uses the item's worktree %s", async (_name, fields, expected) => {
    expect(
      await resolveWorkspace(request({ kind: 'item_worktree' }, fields), depsWith())
    ).toMatchObject({
      kind: 'item_worktree',
      created: false,
      ...expected
    })
  })

  it("fails the run with the item's label when it has no worktree", async () => {
    await expect(
      resolveWorkspace(request({ kind: 'item_worktree' }, { 'worktree.path': null }), depsWith())
    ).rejects.toThrow('No worktree for !1561 web-1493')
  })

  it.each<[string, WorktreeInfo[] | Error, string, string | null]>([
    ['by its worktree id when Orca lists it', listed, 'id:r::/repo', 'r::/repo'],
    ["by path when Orca doesn't", [], 'path:/repo', null],
    ["by path when the list can't be read", new Error('runtime_unavailable'), 'path:/repo', null]
  ])('uses the main checkout %s', async (_name, list, selector, worktreeId) => {
    expect(await resolveWorkspace(request({ kind: 'main_checkout' }, {}), depsWith(list))).toEqual({
      kind: 'main_checkout',
      path: '/repo',
      worktreeId,
      selector,
      created: false
    })
  })

  it('creates a new worktree from the base with the rendered name, linked to the item', async () => {
    const deps = depsWith()
    const ws = await resolveWorkspace(
      request(newWorktree('fix-{ticket.id}-{run.date}', false, 'run'), {
        'ticket.id': 'WEB-2118',
        'mr.iid': 1561
      }),
      deps
    )
    expect(ws).toEqual({
      kind: 'new_worktree',
      path: '/wt/fix-WEB-2118-20261011',
      worktreeId: 'r::/wt/fix-WEB-2118-20261011',
      selector: 'id:r::/wt/fix-WEB-2118-20261011',
      created: true
    })
    expect(deps.created).toEqual([
      {
        repoPath: '/repo',
        name: 'fix-WEB-2118-20261011',
        base: 'origin/dev',
        comment: 'Created by the Pilot automation "Remove manual memo" (run m04-1)',
        linkedLinearIssue: 'WEB-2118',
        linkedGitLabMR: 1561,
        setup: 'run',
        noParent: true
      }
    ])
  })

  it.each<[string, boolean, boolean]>([
    ['reuses a worktree of that name (prefixed branch)', true, false],
    ['creates one anyway without reuse_existing', false, true]
  ])('%s', async (_name, reuse, created) => {
    const deps = depsWith()
    const ws = await resolveWorkspace(request(newWorktree('memo-{run.date}', reuse), {}), deps)
    expect(ws.created).toBe(created)
    expect(deps.created.length).toBe(created ? 1 : 0)
  })

  it("fails before creating anything when the name's placeholder has no value", async () => {
    const deps = depsWith()
    await expect(
      resolveWorkspace(request(newWorktree('fix-{ticket.id}', false), {}), deps)
    ).rejects.toThrow("Can't name the new worktree: ticket.id missing")
    expect(deps.created).toEqual([])
  })
})

describe('runtimeWorkspaceDeps', () => {
  it.each<['run' | 'skip']>([['skip'], ['run']])(
    'creates through Orca by repo path, from the base, without a parent, setup %s, in the background',
    async (setup) => {
      const createManagedWorktree = vi.fn(async () => ({
        worktree: { id: 'r::/wt/x', path: '/wt/x' }
      }))
      const runtime = { createManagedWorktree } as unknown as OrcaRuntimeService
      const deps = runtimeWorkspaceDeps(runtime, async () => [])
      expect(
        await deps.createWorktree({
          repoPath: '/repo',
          name: 'x',
          base: 'origin/dev',
          comment: 'c',
          linkedLinearIssue: 'WEB-1',
          linkedGitLabMR: 7,
          setup,
          noParent: true
        })
      ).toEqual({ id: 'r::/wt/x', path: '/wt/x' })
      expect(createManagedWorktree).toHaveBeenCalledWith({
        repoSelector: 'path:/repo',
        name: 'x',
        baseBranch: 'origin/dev',
        setupDecision: setup,
        lineage: { noParent: true },
        activate: false,
        telemetrySource: 'unknown',
        comment: 'c',
        linkedLinearIssue: 'WEB-1',
        linkedGitLabMR: 7
      })
    }
  )
})
