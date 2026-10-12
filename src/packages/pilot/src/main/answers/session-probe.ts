import { statSync } from 'node:fs'
import type { AgentKind } from '../../shared/definition/types'
import { PromptNotSentError, type SessionTerminals } from '../run/agent-step'
import { findLiveTab } from '../run/session-tabs'
import { defaultUsagePaths, findSessionTranscript, type UsagePaths } from '../usage/step-usage'
import type { SessionProbe, TerminalState, TranscriptFacts } from './sessions'

// Nothing was typed: someone's draft is in the input.
export class DraftInProgressError extends PromptNotSentError {
  constructor(handle: string) {
    super(`unsent text in the input of ${handle}`)
    this.name = 'DraftInProgressError'
  }
}

function statOf(path: string): TranscriptFacts | null {
  try {
    const s = statSync(path)
    return s.isFile() ? { size: s.size, mtimeMs: s.mtimeMs } : null
  } catch {
    return null
  }
}

// usage's finders (CLAUDE_CONFIG_DIR, Codex day folders in every Codex home), so the fork check looks where
// usage does, without walking a whole Codex home.
export async function findTranscript(
  agent: AgentKind,
  sessionId: string,
  knownPath: string | null,
  startedAt: number,
  paths: UsagePaths = defaultUsagePaths()
): Promise<TranscriptFacts | null> {
  const path = await findSessionTranscript(agent, sessionId, knownPath, startedAt, paths)
  return path ? statOf(path) : null
}

export type SessionLookDeps = {
  // The run launcher's own H10 helpers (run/launch.ts runtimeSessionTerminals): one process per session.
  terminals: SessionTerminals
  // The terminal's unsent input, read from its screen (runtimeFieldDeps.terminalDraft).
  draft(handle: string): Promise<string>
  // A Pilot step is starting or running on this terminal (the store, before any probe).
  stepOn(handle: string): boolean
}

async function busyOrTyping(deps: SessionLookDeps, handle: string): Promise<TerminalState> {
  try {
    return (await deps.draft(handle)).trim() ? 'typing' : 'busy'
  } catch {
    return 'busy'
  }
}

// The asking tab is gone (or runs another session) but the session may live in a tab no step row names: one
// the person opened, Resume opened, or another run holds. Never a second process: it reads as busy, or typing
// when someone has a draft there; never free, since that tab's process args are not Pilot's to trust.
async function elsewhere(
  deps: SessionLookDeps,
  askingHandle: string,
  sessionId: string
): Promise<TerminalState | null> {
  const found = await findLiveTab(
    {
      state: (t, id) => deps.terminals.state(t, id),
      tabs: deps.terminals.tabs,
      stepOn: deps.stepOn
    },
    sessionId,
    [],
    new Set([askingHandle])
  )
  if (!found) {
    return null
  }
  return busyOrTyping(deps, found.handle)
}

// The asking tab, looked at the way the run launcher looks before it sends a step into a session's
// terminal: a Pilot step on it is busy whatever it shows; else the launcher's state (anything unreadable
// is busy). A busy tab with a draft reads as typing, so its answers wait for the person.
export function sessionTerminalProbe(
  deps: SessionLookDeps,
  paths: UsagePaths = defaultUsagePaths()
): SessionProbe {
  return {
    async terminalState({ handle, paneKey, sessionId }) {
      // A claim whose start has landed (or died) is dropped first, so it doesn't force forks until its TTL.
      await deps.terminals.claims?.expireIfSeen(sessionId)
      if (deps.stepOn(handle) || deps.terminals.claims?.holder(sessionId)) {
        return 'busy'
      }
      const state = await deps.terminals.state({ handle, paneKey }, sessionId)
      if (state === 'gone' || state === 'other') {
        return (await elsewhere(deps, handle, sessionId)) ?? state
      }
      return state === 'busy' ? busyOrTyping(deps, handle) : state
    },
    transcript: (agent, sessionId, knownPath, startedAt) =>
      findTranscript(agent, sessionId, knownPath, startedAt, paths)
  }
}

// gate.py send_prompt: never type into a draft (read again right before typing), then the launcher's
// send, which types only into an idle foreground agent and requires the prompt to start a turn.
export function sessionPromptSender(
  deps: Pick<SessionLookDeps, 'terminals' | 'draft'>
): (handle: string, prompt: string) => Promise<void> {
  return async (handle, prompt) => {
    let draft: string
    try {
      draft = await deps.draft(handle)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new PromptNotSentError(`the input of ${handle} could not be read: ${message}`)
    }
    if (draft.trim()) {
      throw new DraftInProgressError(handle)
    }
    await deps.terminals.send(handle, prompt)
  }
}
