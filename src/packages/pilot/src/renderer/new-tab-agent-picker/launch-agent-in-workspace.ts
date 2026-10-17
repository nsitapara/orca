import { toast } from 'sonner'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { launchAgentInNewTab, type LaunchAgentInNewTabArgs } from '@/lib/launch-agent-in-new-tab'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { TuiAgent } from '../../../../../shared/tui-agent'

/** Another machine's workspace the launch opens in, switched to only once its surface opens. */
export type WorkspaceLaunchSwitch = { executionHostId: ExecutionHostId; machineLabel: string }

// Why: activating here, not before the launch, keeps a launch that fails early from switching workspace.
function switchBeforeSurfaceOpen(
  worktreeId: string,
  switchTo: WorkspaceLaunchSwitch | undefined
): LaunchAgentInNewTabArgs['beforeSurfaceOpen'] {
  if (!switchTo) {
    return undefined
  }
  // The launcher opens the agent's surface itself, so revealing must not seed a sibling shell.
  return () =>
    activateAndRevealWorktree(worktreeId, {
      executionHostId: switchTo.executionHostId,
      providesInitialSurface: true
    }) !== false
}

function launchFailureMessage(
  agent: TuiAgent,
  switchTo: WorkspaceLaunchSwitch | undefined
): string {
  if (switchTo) {
    return `Could not open ${agent} on ${switchTo.machineLabel}.`
  }
  return `Could not build launch command for ${agent}.`
}

// Mirrors the tab bar's quick launch: launch, then focus a local terminal tab.
export function launchAgentInWorkspace({
  worktreeId,
  agent,
  switchTo
}: {
  worktreeId: string
  agent: TuiAgent
  switchTo?: WorkspaceLaunchSwitch
}): void {
  const state = useAppStore.getState()
  const result = launchAgentInNewTab({
    requestId: newAgentLaunchRequestId(),
    agent,
    worktreeId,
    groupId:
      state.activeGroupIdByWorktree[worktreeId] ?? state.groupsByWorktree[worktreeId]?.[0]?.id,
    launchSource: 'shortcut',
    beforeSurfaceOpen: switchBeforeSurfaceOpen(worktreeId, switchTo)
  })
  if (!result) {
    toast.error(launchFailureMessage(agent, switchTo))
    return
  }
  if (result.surface.kind === 'local-terminal') {
    focusTerminalTabSurface(result.surface.tabId)
  }
}
