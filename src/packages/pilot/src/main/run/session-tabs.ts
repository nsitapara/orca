import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { KnownTerminal, SessionTerminalState } from './agent-step'
import { newestSessionRow, type AgentRow } from './agent-rows'
import { inPane, LIST_LIMIT } from './terminal-relist'

// One process per agent session (H10): where a session is held is a question about Orca's terminals,
// not only about Pilot's step rows. A tab Resume opened, another run's per_worktree session or one
// the person started by hand has no row of ours, but Orca's agent status rows name its session.
export type SessionTabs = (sessionId: string) => Promise<KnownTerminal[]>

function holdsSession(rows: readonly AgentRow[], sessionId: string): boolean {
  return newestSessionRow(rows)?.providerSession?.id === sessionId
}

// Every terminal that holds this session. Candidate panes are found globally (any provider-session row
// naming it), then each is judged by its own pane's rows, the same read sessionTerminalState makes, so a
// legacy or tmux-inner row difference can't call a live tab gone.
export function runtimeSessionTabs(runtime: OrcaRuntimeService): SessionTabs {
  return async (sessionId) => {
    const candidates = new Set<string>()
    for (const row of runtime.getAgentProviderSessionRows()) {
      if (row.providerSession?.id === sessionId) {
        candidates.add(row.paneKey)
      }
    }
    const panes = [...candidates].filter((paneKey) =>
      holdsSession(runtime.getAgentStatusRowsForPane(paneKey), sessionId)
    )
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
    const found: KnownTerminal[] = []
    for (const paneKey of panes) {
      const terminal = listing.terminals.find((t) => inPane(t, paneKey))
      if (terminal) {
        found.push({ handle: terminal.handle, paneKey })
      }
    }
    return found
  }
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
