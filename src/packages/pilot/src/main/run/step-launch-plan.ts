import { isSessionId, NOT_A_SESSION_ID } from '../../shared/session-id'
import type { ItemFields, StepRow } from '../../shared/api-types'
import type { AgentKind, AutomationDefinition, StepDef } from '../../shared/definition/types'
import { renderTemplate } from '../../shared/template'
import type { PilotAgentLaunchOptions } from './agent-launch-hook'

// fresh: a new session (Claude's pinned to sessionId; Codex's learned from hooks, Task 28).
// fork: a new session that starts from a copy of an old one (Task 24b's answer runs); planSession
// never returns it, the caller builds it.
export type SessionPlan =
  | { kind: 'fresh'; sessionId: string | null }
  | { kind: 'resume'; sessionId: string }
  | { kind: 'fork'; sessionId: string }
  | { kind: 'missing'; reason: string }

export type SessionInput = {
  step: StepDef
  agent: AgentKind
  priorSteps: readonly Pick<StepRow, 'name' | 'agent' | 'sessionId'>[]
  worktreeSession: string | null
  newId(): string
}

function fresh(agent: AgentKind, newId: () => string): SessionPlan {
  return { kind: 'fresh', sessionId: agent === 'claude' ? newId() : null }
}

export function planSession(input: SessionInput): SessionPlan {
  const { step, agent } = input
  const session = step.session
  if (session.kind === 'new') {
    return fresh(agent, input.newId)
  }
  if (session.kind === 'per_worktree') {
    if (isSessionId(input.worktreeSession)) {
      return { kind: 'resume', sessionId: input.worktreeSession }
    }
    if (input.worktreeSession) {
      console.warn(
        `pilot: stored session ${JSON.stringify(input.worktreeSession)} ${NOT_A_SESSION_ID}; starting fresh`
      )
    }
    return fresh(agent, input.newId)
  }
  const earlier = input.priorSteps.find((s) => s.name === session.step)
  if (!earlier) {
    return {
      kind: 'missing',
      reason: `Step "${session.step}" hasn't run, so step "${step.name}" has no session to continue`
    }
  }
  if (earlier.agent !== agent) {
    return {
      kind: 'missing',
      reason: `Step "${session.step}" ran ${earlier.agent}; step "${step.name}" runs ${agent}`
    }
  }
  if (!earlier.sessionId) {
    return { kind: 'missing', reason: `Step "${session.step}" has no session id to continue` }
  }
  if (!isSessionId(earlier.sessionId)) {
    return {
      kind: 'missing',
      reason: `Step "${session.step}"'s session ${NOT_A_SESSION_ID}; it can't be continued`
    }
  }
  return { kind: 'resume', sessionId: earlier.sessionId }
}

// A session id only ever reaches argv in the UUID shape (shared/session-id.ts): checked again here, whoever
// planned the session, so a flag-shaped id can never inject an argument.
function idArg(sessionId: string): string {
  if (!isSessionId(sessionId)) {
    throw new Error(`${JSON.stringify(sessionId)} ${NOT_A_SESSION_ID}; nothing launched`)
  }
  return sessionId
}

// Goes before the prompt in the launch command (pilot-hook: agent-launch-env).
export function agentArgv(
  agent: AgentKind,
  session: SessionPlan,
  args: readonly string[]
): string[] {
  if (session.kind === 'resume') {
    if (agent === 'claude') {
      return ['--resume', idArg(session.sessionId), ...args]
    }
    return ['resume', idArg(session.sessionId), ...args]
  }
  if (session.kind === 'fork') {
    if (agent === 'claude') {
      return ['--resume', idArg(session.sessionId), '--fork-session', ...args]
    }
    return ['fork', idArg(session.sessionId), ...args]
  }
  if (session.kind === 'fresh' && session.sessionId !== null) {
    return ['--session-id', idArg(session.sessionId), ...args]
  }
  return [...args]
}

export type StepEnvInput = {
  runId: string
  automationId: string
  itemKey: string
  stepName: string
  stepIdx: number
  powers: readonly string[]
}

// Spec §8: every step's env (agent terminals and shell steps). AGENT_RUN for skills that already read it.
export function pilotStepEnv(input: StepEnvInput): Record<string, string> {
  return {
    PILOT_RUN_ID: input.runId,
    PILOT_STEP: input.stepName,
    PILOT_STEP_IDX: String(input.stepIdx),
    PILOT_AUTOMATION_ID: input.automationId,
    PILOT_ITEM_KEY: input.itemKey,
    PILOT_POWERS: input.powers.join(','),
    AGENT_RUN: input.runId
  }
}

// What the Task 8a hook needs for one agent terminal: the step env and the argv (session, then args)
// ride on `pilot`, the rest is launchAgentTerminal's own options.
export function terminalLaunchOptions(input: {
  agent: AgentKind
  prompt: string
  title: string
  env: StepEnvInput
  args: readonly string[]
  session: SessionPlan
  runEnv?: Record<string, string>
}): PilotAgentLaunchOptions {
  return {
    agent: input.agent,
    prompt: input.prompt,
    title: input.title,
    pilot: {
      // The env's variables first: Pilot's own step env always wins (parseEnvResult refuses PILOT_*/ORCA_* anyway).
      env: { ...input.runEnv, ...pilotStepEnv(input.env) },
      argv: agentArgv(input.agent, input.session, input.args)
    }
  }
}

export type PromptInput = {
  definition: AutomationDefinition
  step: StepDef
  runId: string
  label: string
  fields: ItemFields
  modeText: string | null
}

// wrapped: who started it, the skill, the mode's text, then the prompt. raw: the prompt exactly.
// A placeholder whose field is missing stays literal (renderTemplate's behaviour).
export function buildStepPrompt(input: PromptInput): string {
  const { definition, step } = input
  const rendered = renderTemplate(step.prompt ?? '', input.fields).text.trim()
  if (step.promptStyle === 'raw') {
    return rendered
  }
  const lines = [
    `Started by the Pilot automation "${definition.name}" (run ${input.runId}) for ${input.label}.`
  ]
  if (step.skill) {
    lines.push(`Use the ${step.skill} skill.`)
  }
  const mode = input.modeText?.trim()
  if (mode) {
    lines.push('', mode)
  }
  if (rendered) {
    lines.push('', rendered)
  }
  return lines.join('\n')
}

// A continued run's step, resumed in its own session (run-continue.ts): the session already holds the step's
// instructions, so it is told only why it stopped and to carry on.
export function continuePrompt(stepName: string, reason: string): string {
  return [
    `Pilot is continuing step "${stepName}" in this session: it stopped before it finished (${reason}).`,
    'Carry on from where you left off. Check what is already done before doing any of it again, then finish the step as its instructions say, outputs included.'
  ].join(' ')
}

export function stepTitle(definition: AutomationDefinition, step: StepDef, label: string): string {
  if (definition.steps.length > 1) {
    return `${definition.name} · ${label} · ${step.name}`
  }
  return `${definition.name} · ${label}`
}
