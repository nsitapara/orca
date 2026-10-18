import { pickTuiAgent } from '../../../shared/tui-agent-selection'
import { withTimeout } from '../../../shared/promise-timeout-fallback'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import {
  getAgentDetectionTargetKeyForWorktree,
  parseAgentDetectionTargetKey
} from '@/hooks/useAgentDetectionTarget'
import type { AgentDetectionTarget } from '@/hooks/useDetectedAgents'
import {
  ensureDetectedAgentsForTarget,
  readDetectedAgentsForTarget
} from '@/lib/agent-detection-target-inventory'
import { workspaceKindForWorktreeId } from '@/lib/agent-launch-route-input'
import { planAgentSessionLaunch } from '@/lib/agent-session-launch-plan'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'

// Why bounded: detection only decides agent vs shell, so a slow host must not hold the workspace empty.
const DEFAULT_AGENT_DETECTION_TIMEOUT_MS = 5_000

/**
 * The host whose agent list picks the default agent; undefined when the workspace opens a shell
 * whatever that list says. Shared by the wait and the open so they cannot drift.
 */
function defaultAgentDetectionTarget(
  state: AppState,
  worktreeId: string
): AgentDetectionTarget | undefined {
  // Why: a 'blank' default agent also means the user wants workspaces to open without one.
  if (
    state.settings?.emptyWorkspaceOpenSurface === 'terminal' ||
    state.settings?.defaultTuiAgent === 'blank'
  ) {
    return undefined
  }
  // Why: an unresolved owner is an unknown host, not the local machine.
  return parseAgentDetectionTargetKey(getAgentDetectionTargetKeyForWorktree(state, worktreeId))
}

/** True when the default agent could open here but the workspace host's agent list has not loaded. */
export function emptyWorkspaceDefaultAgentAwaitsDetection(worktreeId: string): boolean {
  const state = useAppStore.getState()
  const target = defaultAgentDetectionTarget(state, worktreeId)
  return target !== undefined && readDetectedAgentsForTarget(state, target) === null
}

/** Loads the workspace host's agent list; resolves on success, failure, or timeout. */
export async function loadEmptyWorkspaceDefaultAgentDetection(worktreeId: string): Promise<void> {
  const state = useAppStore.getState()
  const target = defaultAgentDetectionTarget(state, worktreeId)
  if (!target) {
    return
  }
  await withTimeout(
    ensureDetectedAgentsForTarget(state, target),
    DEFAULT_AGENT_DETECTION_TIMEOUT_MS,
    []
  )
}

/**
 * Unless the user picked Terminal for empty workspaces, one opens their default agent instead of a
 * bare shell: as a chat when the launch routes there, else in its terminal. Null means nothing
 * opened and the caller seeds the shell.
 */
export function openDefaultAgentInEmptyWorkspace(
  worktreeId: string
): { primaryTabId: string | null } | null {
  const state = useAppStore.getState()
  const target = defaultAgentDetectionTarget(state, worktreeId)
  if (!target) {
    return null
  }
  const agent = pickTuiAgent(
    state.settings?.defaultTuiAgent,
    readDetectedAgentsForTarget(state, target) ?? [],
    state.settings?.disabledTuiAgents
  )
  if (!agent) {
    return null
  }
  // No user gesture: opening this empty workspace is the one action this launch serves.
  const agentSessionLaunchPlan = planAgentSessionLaunch(state, {
    requestId: newAgentLaunchRequestId(),
    agent,
    workspace: { kind: workspaceKindForWorktreeId(worktreeId), worktreeId }
  })
  // A host's "no" to the chat opens the agent's terminal, the same as any new agent tab.
  const result = launchAgentInNewTab({
    agent,
    worktreeId,
    launchSource: 'unknown',
    agentSessionLaunchPlan,
    pendingActivationSpawn: true
  })
  if (!result) {
    return null
  }
  return { primaryTabId: result.surface.kind === 'host-published' ? null : result.surface.tabId }
}
