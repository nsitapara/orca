import { isSessionId } from '../../shared/session-id'
import type { InboxItemRow } from '../../shared/api-types'
import type { AgentKind, AutomationDefinition } from '../../shared/definition/types'
import type { SessionTerminalState } from '../run/agent-step'
import type { PilotStore } from '../store/store'
import { hold, type Hold } from './holds'

// apply.py FORK_MAX_BYTES / FORK_MAX_AGE_DAYS: past these a fresh session reading the card costs less.
export const FORK_MAX_BYTES = 8_000_000
export const FORK_MAX_AGE_MS = 3 * 24 * 60 * 60_000

export type AskingSession = {
  runId: string
  stepIdx: number
  agent: AgentKind
  skill: string | null
  sessionId: string | null
  terminalHandle: string | null
  paneKey: string | null
  transcriptPath: string | null
  startedAt: number | null
  // The args the asking process runs under (its step's launch_args_json); null when not known.
  launchArgs: string[] | null
}
// The run launcher's H10 states (free: an idle agent running this session, nobody typing, no Pilot
// step on it), with a draft told apart from other busy: the answers wait instead of forking past it.
export type TerminalState = SessionTerminalState | 'typing'
export type TranscriptFacts = { size: number; mtimeMs: number }
export type SessionProbe = {
  terminalState(asking: {
    handle: string
    paneKey: string | null
    sessionId: string
  }): Promise<TerminalState>
  // startedAt: when the session's step started (Codex files its rollout under that day).
  transcript(
    agent: AgentKind,
    sessionId: string,
    knownPath: string | null,
    startedAt: number
  ): Promise<TranscriptFacts | null>
}
export type SessionTarget =
  | { kind: 'resume'; asking: AskingSession; handle: string; paneKey: string | null }
  | { kind: 'fork'; asking: AskingSession; sessionId: string }
  // fresh: a card from a throwaway run, whose session went with its folder; the new session gets the cards' context.
  | { kind: 'new'; agent: AgentKind; skill: string | null; mode: string; fresh?: 'throwaway' }

function isAgent(agent: string): agent is AgentKind {
  return agent === 'claude' || agent === 'codex'
}

// The step that asked the newest of these cards (apply.py asking_session: the newest asking run). A card
// without a step index belongs to its run's last agent step.
export function askingSession(store: PilotStore, items: InboxItemRow[]): AskingSession | null {
  const newestFirst = items
    .filter((i) => i.runId !== null)
    .toSorted((a, b) => b.createdAt - a.createdAt)
  for (const item of newestFirst) {
    const steps = store.runs.steps(item.runId as string)
    const step =
      item.stepIdx === null
        ? steps.findLast((s) => isAgent(s.agent))
        : steps.find((s) => s.idx === item.stepIdx)
    if (step && isAgent(step.agent)) {
      return {
        runId: step.runId,
        stepIdx: step.idx,
        agent: step.agent,
        skill: step.skill,
        sessionId: step.sessionId,
        terminalHandle: step.terminalHandle,
        paneKey: step.paneKey,
        transcriptPath: step.transcriptPath,
        startedAt: step.startedAt,
        launchArgs: step.launchArgs
      }
    }
  }
  return null
}

function forkable(facts: TranscriptFacts | null, now: number): boolean {
  return facts !== null && facts.size <= FORK_MAX_BYTES && now - facts.mtimeMs <= FORK_MAX_AGE_MS
}

// The skill and mode file that say how this automation's answers are applied.
export function answersModeOf(
  def: AutomationDefinition,
  asking: Pick<AskingSession, 'skill'> | null
): { skill: string | null; mode: string } {
  const other = def.answers?.else ?? null
  return {
    skill: other?.skill ?? asking?.skill ?? def.steps.find((s) => s.skill)?.skill ?? null,
    mode: other?.mode ?? 'answers'
  }
}

export function newSession(
  def: AutomationDefinition,
  asking: AskingSession | null
): Extract<SessionTarget, { kind: 'new' }> {
  const other = def.answers?.else ?? null
  return {
    kind: 'new',
    agent: other?.agent ?? asking?.agent ?? 'claude',
    ...answersModeOf(def, asking)
  }
}

// apply.py start_agent: the asking session's own tab, typed into only when it is free and its process's
// args are known (one process per session); else a fork of that session; else a new answers session.
// The probe throws when the tab can't be read; the caller holds the answers.
export async function chooseSession(
  def: AutomationDefinition,
  items: InboxItemRow[],
  store: PilotStore,
  probe: SessionProbe,
  now: number
): Promise<SessionTarget | { kind: 'hold'; hold: Hold }> {
  const asking = def.answers?.resume === 'never' ? null : askingSession(store, items)
  // Decided at answer time (M4 §8): a card from a throwaway run gets a fresh session carrying the card's context.
  if (asking && store.runs.get(asking.runId)?.env?.mode === 'throwaway') {
    return { ...newSession(def, asking), fresh: 'throwaway' }
  }
  // Only a session id is resumed or forked (it becomes argv); anything else starts a new session.
  if (!asking?.sessionId || !isSessionId(asking.sessionId)) {
    return newSession(def, asking)
  }
  if (asking.terminalHandle) {
    const look = { handle: asking.terminalHandle, paneKey: asking.paneKey }
    const state = await probe.terminalState({ ...look, sessionId: asking.sessionId })
    if (state === 'free' && asking.launchArgs !== null) {
      return { kind: 'resume', asking, ...look }
    }
    if (state === 'typing') {
      return { kind: 'hold', hold: hold('typing', 'someone is typing in the tab that asked') }
    }
  }
  const facts = await probe.transcript(
    asking.agent,
    asking.sessionId,
    asking.transcriptPath,
    asking.startedAt ?? now
  )
  if (forkable(facts, now)) {
    return { kind: 'fork', asking, sessionId: asking.sessionId }
  }
  return newSession(def, asking)
}
