import type { AgentKind, AutomationDefinition } from '../../shared/definition/types'
import { isSessionId, NOT_A_SESSION_ID } from '../../shared/session-id'
import type { PilotStore } from '../store/store'
import type { AgentStepDeps, AgentStepRequest } from './agent-step'

// session: per_worktree (§9 agent_sessions): the session an automation's agent keeps in one worktree, as
// it is remembered at launch or once learned, and checked before it is resumed.

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// per_worktree: the next run of this automation in this worktree resumes this session (§9 agent_sessions).
export function rememberWorktreeSession(
  store: PilotStore,
  req: AgentStepRequest,
  agent: AgentKind,
  sessionId: string | null,
  at: number
): void {
  if (req.definition.steps[req.stepIdx].session.kind !== 'per_worktree' || sessionId === null) {
    return
  }
  try {
    store.sessions.set(req.definition.id, req.workspace.path, agent, sessionId, at)
  } catch (error) {
    console.error(
      `pilot: couldn't remember the session for ${req.workspace.path}: ${messageOf(error)}`
    )
  }
}

// A session id learned after launch (a fresh Codex step's, from its hooks): a per_worktree step keeps it for
// the automation's next run in that worktree, as rememberWorktreeSession does for an id known at launch.
export function rememberLearnedSession(
  store: PilotStore,
  definitionFor: (automationId: string) => AutomationDefinition | null,
  step: { runId: string; idx: number; agent: string },
  sessionId: string,
  at: number
): void {
  const run = store.runs.get(step.runId)
  const def = run ? definitionFor(run.automationId) : null
  const stepDef = def?.steps[step.idx]
  if (
    !isSessionId(sessionId) ||
    !run?.worktreePath ||
    !def ||
    stepDef?.session.kind !== 'per_worktree'
  ) {
    return
  }
  if (stepDef.agent !== step.agent) {
    return
  }
  store.sessions.set(def.id, run.worktreePath, step.agent, sessionId, at)
}

// The per_worktree session to resume, or null to start fresh. One whose transcript is gone (Claude deletes
// them after 30 days; a pinned session that never started has none) would make `--resume` exit to a shell
// and the step read working until its timeout, holding the worktree: it is forgotten instead.
export async function worktreeSessionToResume(
  store: PilotStore,
  req: AgentStepRequest,
  agent: AgentKind,
  deps: AgentStepDeps
): Promise<string | null> {
  const { definition, workspace } = req
  const stored = store.sessions.get(definition.id, workspace.path, agent)
  if (!stored) {
    return null
  }
  if (!isSessionId(stored.sessionId)) {
    console.warn(
      `pilot: stored session of ${definition.id} in ${workspace.path} ${NOT_A_SESSION_ID}; starting fresh`
    )
    store.sessions.forget(definition.id, workspace.path, agent)
    return null
  }
  const facts = store.runs.sessionFacts(stored.sessionId)
  const startedAt = facts.firstStartedAt ?? stored.updatedAt
  if (await deps.transcriptExists(agent, stored.sessionId, facts.transcriptPath, startedAt)) {
    return stored.sessionId
  }
  console.warn(
    `pilot: session ${stored.sessionId} of ${definition.id} in ${workspace.path} has no transcript; starting fresh`
  )
  store.sessions.forget(definition.id, workspace.path, agent)
  return null
}
