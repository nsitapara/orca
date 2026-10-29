import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { PilotStore } from '../store/store'
import { SESSION_LOOKBACK_MS } from './runtime-facts'
import { countGitStatus, runtimeFieldDeps } from './runtime-field-deps'

const repo = { id: 'r1', path: '/repo', displayName: 'repo' }
function runtimeWith(over: Record<string, unknown> = {}): OrcaRuntimeService {
  return {
    listRepos: () => [repo],
    showTerminal: async () => ({}),
    ...over
  } as unknown as OrcaRuntimeService
}
const store = {
  runs: { sessionStepsIn: () => [], sessionStepsAnyIn: () => [] }
} as unknown as PilotStore

describe('countGitStatus', () => {
  it.each([
    ['', { dirty: 0, untracked: 0 }],
    [' M a\n?? b\n?? c/\nA  d\n\n', { dirty: 2, untracked: 2 }]
  ])('%j', (porcelain, counts) => {
    expect(countGitStatus(porcelain)).toEqual(counts)
  })
})

describe('runtimeFieldDeps', () => {
  it('lists worktrees with their head, linked Linear issue and refs/heads stripped', async () => {
    const listManagedWorktrees = async () => ({
      worktrees: [
        {
          id: 'r1::/wt',
          linkedLinearIssue: 'WEB-1',
          git: { path: '/wt', branch: 'refs/heads/web-1-x', head: 'abc' }
        },
        { id: 'r1::/wt2', linkedLinearIssue: null, git: { path: '/wt2', branch: 'b', head: '' } }
      ],
      totalCount: 2,
      truncated: false
    })
    expect(
      await runtimeFieldDeps(runtimeWith({ listManagedWorktrees }), store).listWorktrees('/repo')
    ).toEqual([
      { id: 'r1::/wt', path: '/wt', branch: 'web-1-x', head: 'abc', linkedLinearIssue: 'WEB-1' },
      { id: 'r1::/wt2', path: '/wt2', branch: 'b', head: null, linkedLinearIssue: null }
    ])
  })

  it('throws when the worktree list is cut short or the repo is unknown', async () => {
    const cut = async () => ({ worktrees: [], totalCount: 500, truncated: true })
    const deps = runtimeFieldDeps(runtimeWith({ listManagedWorktrees: cut }), store)
    await expect(deps.listWorktrees('/repo')).rejects.toThrow('cut short')
    await expect(deps.listWorktrees('/elsewhere')).rejects.toThrow("isn't added")
  })

  it('splits git status into tracked and untracked changes, with optional locks off', async () => {
    const git = vi.fn(async () => ({ stdout: ' M a\n?? b\n' }))
    expect(await runtimeFieldDeps(runtimeWith(), store, { git }).gitStatus('/wt')).toEqual({
      dirty: 1,
      untracked: 1
    })
    expect(git).toHaveBeenCalledWith(
      ['status', '--porcelain=v1'],
      expect.objectContaining({
        cwd: '/wt',
        env: expect.objectContaining({ GIT_OPTIONAL_LOCKS: '0' })
      })
    )
  })

  it('finds the git dir for an operation in progress with optional locks off too', async () => {
    const git = vi.fn(async () => ({ stdout: '/nowhere/.git\n' }))
    expect(await runtimeFieldDeps(runtimeWith(), store, { git }).gitOperation('/wt')).toBeNull()
    expect(git).toHaveBeenCalledWith(
      ['rev-parse', '--git-dir'],
      expect.objectContaining({
        cwd: '/wt',
        env: expect.objectContaining({ GIT_OPTIONAL_LOCKS: '0' })
      })
    )
  })

  it('reads the unsent draft from the rendered screen', async () => {
    const readTerminal = vi.fn(async () => ({ handle: 't1', tail: [], draft: 'half a prompt' }))
    const deps = runtimeFieldDeps(runtimeWith({ readTerminal }), store)
    expect(await deps.terminalDraft('t1')).toBe('half a prompt')
    expect(readTerminal).toHaveBeenCalledWith('t1', { screen: true, limit: 1 })
    readTerminal.mockResolvedValueOnce({ handle: 't1', tail: [] } as never)
    expect(await deps.terminalDraft('t1')).toBe('')
  })

  it.each([
    ['no rows', [], 'idle'],
    ['working', [{ state: 'working', receivedAt: 1 }], 'working'],
    ['blocked, asking for input', [{ state: 'blocked', receivedAt: 1 }], 'waiting'],
    ['a finished turn', [{ state: 'done', receivedAt: 1 }], 'idle'],
    [
      "Claude's SessionStart, which is not a finished turn",
      [{ state: 'done', sessionBoundary: true, receivedAt: 1 }],
      'working'
    ],
    [
      'a turn over: monitoring, its main agent done',
      [
        { state: 'working', workingMode: 'monitoring', mainAgent: { state: 'done' }, receivedAt: 1 }
      ],
      'idle'
    ],
    [
      'monitoring while its main agent works',
      [
        {
          state: 'working',
          workingMode: 'monitoring',
          mainAgent: { state: 'working' },
          receivedAt: 1
        }
      ],
      'working'
    ],
    [
      'monitoring with no main agent',
      [{ state: 'working', workingMode: 'monitoring', receivedAt: 1 }],
      'working'
    ],
    [
      'the newest live row, ignoring session-only rows',
      [
        { state: 'working', receivedAt: 1 },
        { state: 'done', receivedAt: 2 },
        { state: 'working', receivedAt: 3, providerSessionOnly: true }
      ],
      'idle'
    ]
  ])('pane state: %s', (_name, rows, state) => {
    const deps = runtimeFieldDeps(runtimeWith({ getAgentStatusRowsForPane: () => rows }), store)
    expect(deps.paneState('tab:leaf')).toBe(state)
  })

  it("reads every automation's session steps in a worktree from the last 7 days", () => {
    const sessionStepsAnyIn = vi.fn(() => [
      { status: 'running', terminalHandle: 't1', paneKey: 'p1' },
      { status: 'done', terminalHandle: 't2', paneKey: null }
    ])
    const steps = { runs: { sessionStepsAnyIn } } as unknown as PilotStore
    const deps = runtimeFieldDeps(runtimeWith(), steps, { now: () => SESSION_LOOKBACK_MS + 5 })
    expect(deps.anySessions('/wt')).toEqual([
      { active: true, handle: 't1', paneKey: 'p1' },
      { active: false, handle: 't2', paneKey: null }
    ])
    expect(sessionStepsAnyIn).toHaveBeenCalledWith('/wt', 5)
  })

  // As M1: a stale handle is only a candidate for closed; the PTY host's listing decides.
  it.each([
    ['a stale handle the PTY host no longer lists', false],
    ['a stale handle the PTY host still lists (after a restart)', true]
  ])('terminal alive: %s', async (_name, listed) => {
    const relist = vi.fn(async () => listed)
    const showTerminal = async () => {
      throw new Error('terminal_handle_stale')
    }
    const deps = runtimeFieldDeps(runtimeWith({ showTerminal }), store, { relist })
    expect(await deps.terminalAlive('t', 'tab:leaf')).toBe(listed)
    expect(relist).toHaveBeenCalledWith('t', 'tab:leaf')
  })
})
