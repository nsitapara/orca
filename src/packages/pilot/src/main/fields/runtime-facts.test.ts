import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { PilotStore } from '../store/store'
import { runtimeFactDeps, SESSION_LOOKBACK_MS } from './runtime-facts'

type Runtime = Record<string, unknown>
const asRuntime = (r: Runtime) => r as unknown as OrcaRuntimeService
const store = { runs: { sessionStepsIn: () => [] } } as unknown as PilotStore
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

  // A stale handle is only a candidate for closed: after a restart a live daemon-hosted terminal
  // looks stale too, so the PTY host's listing (relist) decides.
  it.each([
    ['a stale handle the PTY host no longer lists', new Error('terminal_handle_stale'), false],
    ['a stale handle the PTY host still lists (restart)', new Error('terminal_handle_stale'), true],
    ['a terminal_not_found the PTY host no longer lists', new Error('terminal_not_found'), false],
    [
      'a structured-worker handle',
      Object.assign(new Error('t is an agent session'), {
        code: 'terminal_unsupported_for_agent_session'
      }),
      false
    ]
  ])('asks the PTY host about %s', async (_name, error, listed) => {
    const relist = vi.fn(async () => listed)
    const deps = runtimeFactDeps(
      runtimeWith({}, async () => {
        throw error
      }),
      store,
      undefined,
      { relist }
    )
    expect(await deps.terminalAlive('t', 'tab:leaf')).toBe(listed)
    expect(relist).toHaveBeenCalledWith('t', 'tab:leaf')
  })

  it('needs no listing for a live terminal, and keeps other errors unknown', async () => {
    const relist = vi.fn(async () => false)
    const alive = runtimeFactDeps(runtimeWith({}), store, undefined, { relist })
    expect(await alive.terminalAlive('t', null)).toBe(true)
    const notReady = runtimeFactDeps(
      runtimeWith({}, async () => {
        throw new Error('runtime_unavailable')
      }),
      store,
      undefined,
      { relist }
    )
    await expect(notReady.terminalAlive('t', null)).rejects.toThrow('runtime_unavailable')
    expect(relist).not.toHaveBeenCalled()
  })

  it("keeps the fact unknown when the PTY host can't say", async () => {
    const deps = runtimeFactDeps(
      runtimeWith({}, async () => {
        throw new Error('terminal_handle_stale')
      }),
      store,
      undefined,
      {
        relist: async () => {
          throw new Error('terminal_liveness_unavailable')
        }
      }
    )
    await expect(deps.terminalAlive('t', null)).rejects.toThrow('terminal_liveness_unavailable')
  })

  it("reads the automation's session steps from the last 7 days", () => {
    const sessionStepsIn = vi.fn(() => [
      { status: 'running', terminalHandle: 't1', paneKey: 'p1' },
      { status: 'starting', terminalHandle: null, paneKey: null },
      { status: 'done', terminalHandle: 't2', paneKey: 'p2' }
    ])
    const steps = { runs: { sessionStepsIn } } as unknown as PilotStore
    const deps = runtimeFactDeps(runtimeWith({}), steps, undefined, {
      relist: async () => false,
      now: () => SESSION_LOOKBACK_MS + 5
    })
    expect(deps.automationSessions('ci', '/wt')).toEqual([
      { active: true, handle: 't1', paneKey: 'p1' },
      { active: true, handle: null, paneKey: null },
      { active: false, handle: 't2', paneKey: 'p2' }
    ])
    expect(sessionStepsIn).toHaveBeenCalledWith('ci', '/wt', 5)
  })
})
