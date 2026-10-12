import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { AgentKind } from '../../shared/definition/types'
import { PromptNotSentError, type SessionTerminals } from '../run/agent-step'
import { findLiveTab } from '../run/session-tabs'
import { codexHomes } from '../usage/codex-homes'
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

function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(dir, d.name))
  } catch {
    return []
  }
}

function codexRollout(root: string, sessionId: string): string | null {
  try {
    const names = readdirSync(root, { recursive: true, encoding: 'utf8' })
    const found = names.find((n) => n.endsWith('.jsonl') && basename(n).includes(sessionId))
    return found ? join(root, found) : null
  } catch {
    return null
  }
}

// Where usage.py looks (CLAUDE_PROJECTS, CODEX_HOMES), plus Pilot's own Codex home.
export function findTranscript(
  agent: AgentKind,
  sessionId: string,
  knownPath: string | null,
  home: string = homedir(),
  codexHome: string | undefined = process.env.CODEX_HOME
): TranscriptFacts | null {
  const known = knownPath ? statOf(knownPath) : null
  if (known) {
    return known
  }
  if (agent === 'claude') {
    for (const dir of subdirs(join(home, '.claude', 'projects'))) {
      const found = statOf(join(dir, `${sessionId}.jsonl`))
      if (found) {
        return found
      }
    }
    return null
  }
  const homes = codexHomes(codexHome, home)
  for (const root of homes) {
    const file = codexRollout(join(root, 'sessions'), sessionId)
    if (file) {
      return statOf(file)
    }
  }
  return null
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
  home: string = homedir()
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
    transcript: (agent, sessionId, knownPath) => findTranscript(agent, sessionId, knownPath, home)
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
