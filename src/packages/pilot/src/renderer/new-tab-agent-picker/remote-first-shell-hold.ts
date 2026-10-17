import {
  beginWebRuntimeInitialTerminalBootstrap,
  endWebRuntimeInitialTerminalBootstrap
} from '@/runtime/web-runtime-initial-terminal-bootstrap'
import { useAppStore } from '@/store'
import { parseExecutionHostId, type ExecutionHostId } from '../../../../../shared/execution-host'

// Why a limit: a launch that dies before its tab lands must not keep the workspace shell-less for good.
const HOLD_LIMIT_MS = 30_000

const NO_HOLD = (): void => {}

function hasTabs(worktreeId: string): boolean {
  return (useAppStore.getState().tabsByWorktree[worktreeId]?.length ?? 0) > 0
}

/**
 * Stops another machine's never-opened workspace from seeding a blank shell while the agent's tab is
 * on its way (the host's first answer for it is empty). Released when a tab lands, after
 * HOLD_LIMIT_MS, or by calling the returned function.
 */
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
    endWebRuntimeInitialTerminalBootstrap(environmentId, worktreeId)
  }
  unsubscribe = useAppStore.subscribe(() => {
    if (hasTabs(worktreeId)) {
      release()
    }
  })
  timer = setTimeout(release, HOLD_LIMIT_MS)
  return release
}
