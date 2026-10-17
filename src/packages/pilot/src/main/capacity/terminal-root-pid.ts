import type { StepRow } from '../../shared/api-types'

export type TerminalRootDeps = {
  // The runtime's look at a terminal (OrcaRuntimeService.showTerminal); it throws for one that's gone.
  ptyIdOf(handle: string): Promise<string | null>
  // Orca's registry of local PTYs and their spawn pids (src/main/memory/pty-registry.ts).
  listPtys(): readonly { ptyId: string; pid: number | null }[]
}

// Through the PTY id rather than the pane key: after a restart the registry is refilled without pane keys.
export function terminalRootPid(
  deps: TerminalRootDeps
): (step: Pick<StepRow, 'terminalHandle'>) => Promise<number | null> {
  return async (step) => {
    if (step.terminalHandle === null) {
      return null
    }
    let ptyId: string | null
    try {
      ptyId = await deps.ptyIdOf(step.terminalHandle)
    } catch {
      return null
    }
    return ptyId === null ? null : (deps.listPtys().find((p) => p.ptyId === ptyId)?.pid ?? null)
  }
}
