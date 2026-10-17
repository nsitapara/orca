import { toast } from 'sonner'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { launchAgentInNewTab, type LaunchAgentInNewTabArgs } from '@/lib/launch-agent-in-new-tab'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { TuiAgent } from '../../../../../shared/tui-agent'
import { holdRemoteFirstShell } from './remote-first-shell-hold'

/** Another machine's workspace, switched to just before its surface opens, even before the host answers. */
export type WorkspaceLaunchSwitch = { executionHostId: ExecutionHostId; machineLabel: string }

/** The first-shell hold a switch takes; the launch releases it when no agent tab is coming. */
type FirstShellHold = { release: () => void }

// Why: activating here, not before the launch, keeps a launch that fails early from switching workspace.
function switchBeforeSurfaceOpen(
  worktreeId: string,
  switchTo: WorkspaceLaunchSwitch | undefined,
  hold: FirstShellHold
): LaunchAgentInNewTabArgs['beforeSurfaceOpen'] {
  if (!switchTo) {
    return undefined
  }
  // The launcher opens the agent's surface itself, so neither revealing nor the host's first empty answer may seed a sibling shell.
  return () => {
    hold.release = holdRemoteFirstShell(worktreeId, switchTo.executionHostId)
    const switched =
      activateAndRevealWorktree(worktreeId, {
        executionHostId: switchTo.executionHostId,
        providesInitialSurface: true
      }) !== false
    if (!switched) {
      hold.release()
    }
    return switched
  }
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
  const hold: FirstShellHold = { release: () => {} }
  const result = launchAgentInNewTab({
    requestId: newAgentLaunchRequestId(),
    agent,
    worktreeId,
    groupId:
      state.activeGroupIdByWorktree[worktreeId] ?? state.groupsByWorktree[worktreeId]?.[0]?.id,
    launchSource: 'shortcut',
    beforeSurfaceOpen: switchBeforeSurfaceOpen(worktreeId, switchTo, hold)
  })
  if (!result) {
    // Why: a launch can still fail after its switch, and then no agent tab is coming.
    hold.release()
    toast.error(launchFailureMessage(agent, switchTo))
    return
  }
  if (result.surface.kind === 'local-terminal') {
    focusTerminalTabSurface(result.surface.tabId)
  }
}
