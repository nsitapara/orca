import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { KnownTerminal, SessionTerminalState } from './agent-step'
import { judgeClaim, SessionClaims } from './session-claims'
import { newestSessionRow, type AgentRow } from './agent-rows'
import { inPane, LIST_LIMIT } from './terminal-relist'

// One process per agent session (H10): where a session is held is a question about Orca's terminals,
// not only about Pilot's step rows. A tab Resume opened, another run's per_worktree session or one
// the person started by hand has no row of ours, but Orca's agent status rows name its session.
export type SessionTabs = (sessionId: string) => Promise<KnownTerminal[]>

function holdsSession(rows: readonly AgentRow[], sessionId: string): boolean {
  return newestSessionRow(rows)?.providerSession?.id === sessionId
}

export type SessionPane = KnownTerminal & { rowAt: number | null }

// The time of the newest live row naming the session: session-only and restored-unconfirmed rows (an
// exited agent's surviving shell) prove nothing.
function liveRowAt(rows: readonly AgentRow[], sessionId: string): number | null {
  let best: number | null = null
  for (const row of rows) {
    if (row.providerSessionOnly === true || row.restoredUnconfirmed === true) {
      continue
    }
    if (row.providerSession?.id !== sessionId) {
      continue
    }
    const at = row.stateStartedAt ?? row.receivedAt
    if (best === null || at > best) {
      best = at
    }
  }
  return best
}

// Every terminal that holds this session. Candidate panes are found globally (any provider-session row
// naming it), then each is judged by its own pane's rows, the same read sessionTerminalState makes, so a
// legacy or tmux-inner row difference can't call a live tab gone.
export function runtimeSessionPanes(
  runtime: OrcaRuntimeService
): (id: string) => Promise<SessionPane[]> {
  return async (sessionId) => {
    const candidates = new Set<string>()
    for (const row of runtime.getAgentProviderSessionRows()) {
      if (row.providerSession?.id === sessionId) {
        candidates.add(row.paneKey)
      }
    }
    const rowsOf = new Map<string, AgentRow[]>()
    const panes = [...candidates].filter((paneKey) => {
      const rows = runtime.getAgentStatusRowsForPane(paneKey)
      rowsOf.set(paneKey, rows)
      return holdsSession(rows, sessionId)
    })
    if (panes.length === 0) {
      return []
    }
    const listing = await runtime.listTerminals(undefined, LIST_LIMIT, {
      requireFreshPtyLiveness: true,
      includeVisualLayouts: false
    })
    if (listing.truncated) {
      throw new Error(`terminal list cut short (${listing.totalCount} terminals)`)
    }
    const found: SessionPane[] = []
    for (const paneKey of panes) {
      const terminal = listing.terminals.find((t) => inPane(t, paneKey))
      if (terminal) {
        found.push({
          handle: terminal.handle,
          paneKey,
          rowAt: liveRowAt(rowsOf.get(paneKey) ?? [], sessionId)
        })
      }
    }
    return found
  }
}

export function runtimeSessionTabs(runtime: OrcaRuntimeService): SessionTabs {
  const panes = runtimeSessionPanes(runtime)
  return async (sessionId) =>
    (await panes(sessionId)).map(({ handle, paneKey }) => ({ handle, paneKey }))
}

// Orca drops an untargeted liveness listing that a newer one overtook (terminal_liveness_unavailable): two teardowns
// listing at once failed every hour, so their throwaways were never removed (2026-10-22). It's asked again.
const SUPERSEDED = 'terminal_liveness_unavailable'
const LISTING_TRIES = 4
const LISTING_RETRY_MS = 250

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function freshListing(
  runtime: Pick<OrcaRuntimeService, 'listTerminals'>,
  wait: (ms: number) => Promise<void>
): ReturnType<OrcaRuntimeService['listTerminals']> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await runtime.listTerminals(undefined, LIST_LIMIT, {
        requireFreshPtyLiveness: true,
        includeVisualLayouts: false
      })
    } catch (error) {
      if (!(error instanceof Error) || error.message !== SUPERSEDED || attempt >= LISTING_TRIES) {
        throw error
      }
      await wait(LISTING_RETRY_MS * attempt)
    }
  }
}

// Whether the terminal is still connected (a fresh PTY liveness listing).
export async function terminalOpen(
  runtime: Pick<OrcaRuntimeService, 'listTerminals'>,
  handle: string,
  wait: (ms: number) => Promise<void> = sleep
): Promise<boolean> {
  const listing = await freshListing(runtime, wait)
  if (listing.terminals.some((t) => t.handle === handle && t.connected)) {
    return true
  }
  // A cut-short listing can't show it gone: count it open, never dead.
  return listing.truncated === true
}

export type SessionLook = {
  state(terminal: KnownTerminal, sessionId: string): Promise<SessionTerminalState>
  // Absent where only Pilot's own step rows can name a tab.
  tabs?: SessionTabs
  // A Pilot step is starting or running on this handle: busy whatever the tab shows.
  stepOn(handle: string): boolean
}
export type LiveTab = KnownTerminal & { state: 'free' | 'busy' }

// A throwing look counts as busy: never a second process on a session that might be in use.
async function lookAt(
  look: SessionLook,
  t: KnownTerminal,
  id: string
): Promise<SessionTerminalState> {
  if (look.stepOn(t.handle)) {
    return 'busy'
  }
  try {
    return await look.state(t, id)
  } catch {
    return 'busy'
  }
}

// The live tab of a session, across ALL terminals: the `hints` (tabs our step rows name) first, then
// any other terminal Orca says holds the session. Live is free or busy; gone and other aren't.
// `exclude` names handles already judged. A busy tab wins over a free one, so nothing second starts.
export async function findLiveTab(
  look: SessionLook,
  sessionId: string,
  hints: readonly KnownTerminal[] = [],
  exclude: ReadonlySet<string> = new Set()
): Promise<LiveTab | null> {
  const seen = new Set(exclude)
  let free: LiveTab | null = null
  const judge = async (candidates: readonly KnownTerminal[]): Promise<LiveTab | null> => {
    for (const t of candidates) {
      if (seen.has(t.handle)) {
        continue
      }
      seen.add(t.handle)
      const state = await lookAt(look, t, sessionId)
      if (state === 'busy') {
        return { ...t, state }
      }
      if (state === 'free' && !free) {
        free = { ...t, state }
      }
    }
    return null
  }
  const busy = (await judge(hints)) ?? (look.tabs ? await judge(await look.tabs(sessionId)) : null)
  return busy ?? free
}

// One claim table per runtime, shared by every caller that can start a process on a session.
const CLAIMS = new WeakMap<OrcaRuntimeService, SessionClaims>()
export function runtimeClaims(
  runtime: OrcaRuntimeService,
  state: SessionLook['state']
): SessionClaims {
  let claims = CLAIMS.get(runtime)
  if (!claims) {
    const panes = runtimeSessionPanes(runtime)
    claims = new SessionClaims(Date.now, (id, claim) =>
      judgeClaim(
        { panes, state, isOpen: (handle) => terminalOpen(runtime, handle) },
        id,
        claim,
        Date.now()
      )
    )
    CLAIMS.set(runtime, claims)
  }
  return claims
}
