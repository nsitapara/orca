import { describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { resolveRepoPath } from './runtime-facts'

type Runtime = Record<string, unknown>
const asRuntime = (r: Runtime) => r as unknown as OrcaRuntimeService

describe('resolveRepoPath', () => {
  const runtime = asRuntime({
    listRepos: () => [
      { id: 'r1', path: '/code/web-platform', displayName: 'Web', worktreeBaseRef: 'origin/dev' },
      { id: 'r2', path: '/code/tools', displayName: 'tools' }
    ]
  })

  it.each([
    [
      'its display name',
      'Web',
      { name: 'Web', id: 'r1', path: '/code/web-platform', base: 'origin/dev' }
    ],
    [
      'its folder name',
      'web-platform',
      { name: 'web-platform', id: 'r1', path: '/code/web-platform', base: 'origin/dev' }
    ],
    [
      'a repo without a base ref',
      'tools',
      { name: 'tools', id: 'r2', path: '/code/tools', base: null }
    ]
  ])('finds a repo by %s', async (_label, name, facts) => {
    expect(await resolveRepoPath(runtime, name)).toEqual(facts)
  })

  it('says which repo it cannot find', async () => {
    await expect(resolveRepoPath(runtime, 'nope')).rejects.toThrow(
      'Repo "nope" isn\'t added to Pilot'
    )
  })
})
