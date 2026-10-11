import { describe, expect, it } from 'vitest'
import { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { terminalRelister } from './terminal-relist'

// The restart case against the real runtime: a fresh OrcaRuntimeService has no handles, like the app
// right after a restart, while the PTY host still lists the agent's terminal under the handle it was
// spawned with (ORCA_TERMINAL_HANDLE). If upstream stops re-adopting that handle, this test fails.
const WORKTREE = 'repo::/tmp/pilot-relist'
const HANDLE = 'term_40000000-0000-4000-8000-000000000001'

function restartedRuntime(listed: boolean): OrcaRuntimeService {
  const runtime = new OrcaRuntimeService()
  runtime.setPtyController({
    write: () => true,
    kill: () => true,
    getForegroundProcess: async () => null,
    hasPty: () => null,
    listProcesses: async () =>
      listed
        ? [
            {
              id: `${WORKTREE}@@agent`,
              cwd: '/tmp/pilot-relist',
              title: 'claude',
              worktreeId: WORKTREE,
              incarnationId: '40000000-0000-4000-8000-000000000002',
              terminalHandle: HANDLE
            }
          ]
        : []
  })
  return runtime
}

describe('terminalRelister against the runtime', () => {
  it('finds a daemon-hosted terminal again after a restart, under the handle it was spawned with', async () => {
    const runtime = restartedRuntime(true)
    expect(await terminalRelister(runtime)(HANDLE, null)).toBe(true)
  })

  it('reports it closed when the PTY host no longer has it', async () => {
    const runtime = restartedRuntime(false)
    expect(await terminalRelister(runtime)(HANDLE, null)).toBe(false)
  })
})
