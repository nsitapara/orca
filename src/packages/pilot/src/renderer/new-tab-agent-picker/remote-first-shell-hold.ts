import {
  beginWebRuntimeInitialTerminalBootstrap,
  endWebRuntimeInitialTerminalBootstrap
} from '@/runtime/web-runtime-initial-terminal-bootstrap'
import { getWebSessionTabsTrackingGeneration } from '@/runtime/web-session-tabs-sync/tracking-lifecycle'
import { useAppStore } from '@/store'
import { parseExecutionHostId, type ExecutionHostId } from '../../../../../shared/execution-host'

// Why 30 s: outlasts the create's 15 s RPC timeout, as a timed-out create can still land its tab.
const HOLD_LIMIT_MS = 30_000

const NO_HOLD = (): void => {}

function hasTabs(worktreeId: string): boolean {
  return (useAppStore.getState().tabsByWorktree[worktreeId]?.length ?? 0) > 0
}

/** Why: a never-opened workspace's empty first host answer would seed a shell beside the agent. */
export function holdRemoteFirstShell(
  worktreeId: string,
  executionHostId: ExecutionHostId
): () => void {
  const host = parseExecutionHostId(executionHostId)
  if (host?.kind !== 'runtime' || hasTabs(worktreeId)) {
    return NO_HOLD
  }
  const { environmentId } = host
  if (!beginWebRuntimeInitialTerminalBootstrap(environmentId, worktreeId)) {
    return NO_HOLD
  }
  const generation = getWebSessionTabsTrackingGeneration(environmentId)
  let held = true
  let unsubscribe = NO_HOLD
  let timer: ReturnType<typeof setTimeout> | undefined
  const release = (): void => {
    if (!held) {
      return
    }
    held = false
    unsubscribe()
    clearTimeout(timer)
    // Why: a teardown already freed our claim; a later claim belongs to the seeder.
    if (getWebSessionTabsTrackingGeneration(environmentId) === generation) {
      endWebRuntimeInitialTerminalBootstrap(environmentId, worktreeId)
    }
  }
  unsubscribe = useAppStore.subscribe(() => {
    if (hasTabs(worktreeId)) {
      release()
    }
  })
  timer = setTimeout(release, HOLD_LIMIT_MS)
  return release
}
