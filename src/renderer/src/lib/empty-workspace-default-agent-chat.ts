import { pickTuiAgent } from '../../../shared/agent-launch/catalog/tui-agent-selection'
import { acquireAgentLaunchChoices } from './host-chat-program-acquisition'
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
import { workspaceKindForWorktreeId, worktreeLaunchWorkspace } from '@/lib/agent-launch-route-input'
import { chosenAgentChatUnlearned, agentChoiceOpensAsChat } from '@/lib/host-chat-program'
import { planAgentSessionLaunch } from '@/lib/agent-session-launch-plan'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { readAgentLaunchPreferencesForWorktree } from '@/runtime/agent-launch-settings/use-host-agent-launch-preferences'
import type { AgentLaunchPreferences } from '@/runtime/agent-launch-settings/host-agent-launch-preferences-resource'

type DefaultChatHost = { target: AgentDetectionTarget; preferences: AgentLaunchPreferences }

/** Share the host between wait/open; undefined means the workspace opens a shell regardless of agent inventory. */
function defaultChatHost(state: AppState, worktreeId: string): DefaultChatHost | undefined {
  // Why the owner's copy: a paired host keeps its own default agent.
  const preferences = readAgentLaunchPreferencesForWorktree(state, worktreeId)
  const chosen = preferences.defaultTuiAgent
  // Why: only a saved agent opens here; Auto must not turn catalog order into a launch (#36594).
  if (
    state.settings?.emptyWorkspaceOpenSurface === 'terminal' ||
    !chosen ||
    chosen === 'blank'
  ) {
    return undefined
  }
  // Why: an unresolved owner is an unknown host, not the local machine.
  const target = parseAgentDetectionTargetKey(
    getAgentDetectionTargetKeyForWorktree(state, worktreeId)
  )
  return target && { target, preferences }
}

export function emptyWorkspaceDefaultChatAwaitsDetection(worktreeId: string): boolean {
  const state = useAppStore.getState()
  const host = defaultChatHost(state, worktreeId)
  const detected = host && readDetectedAgentsForTarget(state, host.target)
  const workspace = worktreeLaunchWorkspace(worktreeId)
  return (
    detected === null ||
    (!!detected &&
      chosenAgentChatUnlearned(state, host?.preferences.defaultTuiAgent, detected, workspace))
  )
}

export async function loadEmptyWorkspaceDefaultChatDetection(worktreeId: string): Promise<void> {
  const state = useAppStore.getState()
  const host = defaultChatHost(state, worktreeId)
  if (!host) {
    return
  }
  await acquireAgentLaunchChoices(
    worktreeLaunchWorkspace(worktreeId),
    () => ensureDetectedAgentsForTarget(state, host.target),
    undefined,
    true
  ).catch(() => undefined)
}

/**
 * Unless the user picked Terminal for empty workspaces, open their saved default agent: as a chat
 * when it routes there, else in its terminal. Null means nothing opened and the caller seeds the shell.
 */
export function openDefaultAgentChatInEmptyWorkspace(
  worktreeId: string,
  initialCwd?: string
): { primaryTabId: string | null } | null {
  const state = useAppStore.getState()
  const host = defaultChatHost(state, worktreeId)
  if (!host) {
    return null
  }
  const detected = readDetectedAgentsForTarget(state, host.target)
  const agent = pickTuiAgent(
    host.preferences.defaultTuiAgent,
    detected ?? [],
    host.preferences.disabledTuiAgents,
    (chosen) => agentChoiceOpensAsChat(state, chosen, worktreeLaunchWorkspace(worktreeId), detected)
  )
  if (!agent) {
    return null
  }
  // No user gesture: opening this empty workspace is the one action this launch serves.
  const agentSessionLaunchPlan = planAgentSessionLaunch(state, {
    requestId: newAgentLaunchRequestId(),
    agent,
    workspace: { kind: workspaceKindForWorktreeId(worktreeId), worktreeId },
    tuiCustomization: { cwd: initialCwd }
  })
  // A host's "no" to the chat opens the agent's terminal, the same as any new agent tab.
  const result = launchAgentInNewTab({
    agent,
    worktreeId,
    initialCwd,
    launchSource: 'unknown',
    agentSessionLaunchPlan,
    pendingActivationSpawn: true
  })
  if (!result) {
    return null
  }
  return { primaryTabId: result.surface.kind === 'host-published' ? null : result.surface.tabId }
}
