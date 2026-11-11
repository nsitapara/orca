import { toast } from 'sonner'
import { createNonSecureContextUuid } from '../../../../../shared/non-secure-context-uuid'
import { focusTerminalTabSurface } from '@/components/terminal-pane/input/focus/focus-terminal-tab-surface'
import { launchAgentInNewTabWithOutcome } from '@/lib/agent-session/launch/new-tab/launch-agent-in-new-tab'
import type { LaunchAgentInNewTabArgs } from '@/lib/agent-session/launch/new-tab/launch-agent-in-new-tab-args'
import { activateAndRevealWorkspace } from '@/lib/workspace/activation/worktree-activation'
import { useAppStore } from '@/store'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { TuiAgent } from '../../../../../shared/agent-launch/catalog/tui-agent'
import { holdRemoteFirstShell } from './remote-first-shell-hold'

/** Another machine's workspace, switched to just before its surface opens, even before the host answers. */
export type WorkspaceLaunchSwitch = { executionHostId: ExecutionHostId; machineLabel: string }

/** The first-shell hold a switch takes; the launch releases it when no agent tab is coming. */
type FirstShellHold = { release: () => void }

/**
 * Switches to a workspace as a launch's surface is about to open there. The launcher opens that
 * surface itself, so neither revealing nor the host's first empty answer may seed a sibling shell.
 */
export function switchToWorkspaceForLaunch(
  worktreeId: string,
  executionHostId: ExecutionHostId | undefined,
  options: { hold?: FirstShellHold; revealInSidebar?: boolean } = {}
): boolean {
  const hold = options.hold ?? { release: () => {} }
  if (executionHostId) {
    hold.release = holdRemoteFirstShell(worktreeId, executionHostId)
  }
  const switched =
    activateAndRevealWorkspace(worktreeId, {
      providesInitialSurface: true,
      ...(executionHostId ? { executionHostId } : {}),
      ...(options.revealInSidebar === false ? { revealInSidebar: false } : {})
    }) !== false
  if (!switched) {
    hold.release()
  }
  return switched
}

// Why: activating here, not before the launch, keeps a launch that fails early from switching workspace.
function switchBeforeSurfaceOpen(
  worktreeId: string,
  switchTo: WorkspaceLaunchSwitch | undefined,
  hold: FirstShellHold
): LaunchAgentInNewTabArgs['beforeSurfaceOpen'] {
  if (!switchTo) {
    return undefined
  }
  return () => switchToWorkspaceForLaunch(worktreeId, switchTo.executionHostId, { hold })
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
  // Pilot shows its own failure toast, so upstream's notice stays off; a refusal is a failed launch.
  const outcome = launchAgentInNewTabWithOutcome(
    {
      requestId: createNonSecureContextUuid(),
      agent,
      worktreeId,
      groupId:
        state.activeGroupIdByWorktree[worktreeId] ?? state.groupsByWorktree[worktreeId]?.[0]?.id,
      launchSource: 'shortcut',
      beforeSurfaceOpen: switchBeforeSurfaceOpen(worktreeId, switchTo, hold)
    },
    false
  )
  const result = outcome && 'refused' in outcome ? null : outcome
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
