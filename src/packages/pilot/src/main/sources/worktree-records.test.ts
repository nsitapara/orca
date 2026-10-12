import { describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { runtimeWorktreeRecords } from './worktree-records'

const repo = { id: 'repo1', name: 'web-platform', path: '/repo', base: null }
const runtimeOf = (result: unknown) =>
  ({ listManagedWorktrees: async () => result }) as unknown as OrcaRuntimeService

describe('runtimeWorktreeRecords', () => {
  it('maps Orca records, stripping refs/heads/', async () => {
    const list = runtimeWorktreeRecords(
      runtimeOf({
        truncated: false,
        totalCount: 1,
        worktrees: [
          {
            id: 'repo1::/wt/a',
            isArchived: false,
            linkedLinearIssue: undefined,
            git: { path: '/wt/a', branch: 'refs/heads/web-1-a', head: 'abc', isMainWorktree: false }
          }
        ]
      })
    )
    expect(await list(repo)).toEqual([
      {
        id: 'repo1::/wt/a',
        path: '/wt/a',
        branch: 'web-1-a',
        head: 'abc',
        isArchived: false,
        isMain: false,
        linkedLinearIssue: null
      }
    ])
  })

  it('throws on a cut-short list rather than miss worktrees', async () => {
    const list = runtimeWorktreeRecords(
      runtimeOf({ truncated: true, totalCount: 900, worktrees: [] })
    )
    await expect(list(repo)).rejects.toThrow('cut short')
  })
})
