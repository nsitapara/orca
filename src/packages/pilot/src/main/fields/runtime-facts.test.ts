import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { PilotStore } from '../store/store'
import { runtimeFactDeps } from './runtime-facts'

type Runtime = Record<string, unknown>
const asRuntime = (r: Runtime) => r as unknown as OrcaRuntimeService
const store = { runs: { openStepsIn: () => [] } } as unknown as PilotStore
const repo = { id: 'r1', path: '/repo', displayName: 'repo' }

function runtimeWith(
  list: unknown,
  show: () => Promise<unknown> = async () => ({})
): OrcaRuntimeService {
  return asRuntime({
    listRepos: () => [repo],
    listManagedWorktrees: async () => list,
    showTerminal: show
  })
}

describe('runtimeFactDeps', () => {
  it('lists worktrees with refs/heads stripped', async () => {
    const list = {
      worktrees: [{ id: 'r1::/wt', git: { path: '/wt', branch: 'refs/heads/web-1-x' } }],
      totalCount: 1,
      truncated: false
    }
    expect(await runtimeFactDeps(runtimeWith(list), store).listWorktrees('/repo')).toEqual([
      { id: 'r1::/wt', path: '/wt', branch: 'web-1-x' }
    ])
  })

  it('throws when the list is truncated or the repo is unknown', async () => {
    const cut = { worktrees: [], totalCount: 500, truncated: true }
    await expect(runtimeFactDeps(runtimeWith(cut), store).listWorktrees('/repo')).rejects.toThrow(
      'cut short'
    )
    await expect(
      runtimeFactDeps(runtimeWith(cut), store).listWorktrees('/elsewhere')
    ).rejects.toThrow("isn't added")
  })

  it('counts porcelain lines and runs status with optional locks disabled', async () => {
    const git = vi.fn(async () => ({ stdout: ' M a\n?? b\n\n' }))
    expect(await runtimeFactDeps(runtimeWith({}), store, git).gitStatusCount('/wt')).toBe(2)
    expect(git).toHaveBeenCalledWith(
      ['status', '--porcelain=v1'],
      expect.objectContaining({
        cwd: '/wt',
        env: expect.objectContaining({ GIT_OPTIONAL_LOCKS: '0' })
      })
    )
  })

  it('joins a relative git dir onto the worktree before looking for markers', async () => {
    const git = vi.fn(async () => ({ stdout: '.git\n' }))
    expect(
      await runtimeFactDeps(runtimeWith({}), store, git).gitOperation('/nonexistent-wt')
    ).toBeNull()
    expect(git).toHaveBeenCalledWith(
      ['rev-parse', '--git-dir'],
      expect.objectContaining({ cwd: '/nonexistent-wt' })
    )
  })

  it('treats only a stale handle as a dead terminal', async () => {
    const dead = runtimeFactDeps(
      runtimeWith({}, async () => {
        throw new Error('terminal_handle_stale')
      }),
      store
    )
    expect(await dead.terminalAlive('t')).toBe(false)
    const notReady = runtimeFactDeps(
      runtimeWith({}, async () => {
        throw new Error('runtime_unavailable')
      }),
      store
    )
    await expect(notReady.terminalAlive('t')).rejects.toThrow('runtime_unavailable')
    const alive = runtimeFactDeps(runtimeWith({}), store)
    expect(await alive.terminalAlive('t')).toBe(true)
  })
})
