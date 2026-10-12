import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { KnownTerminal, SessionTerminalState } from './agent-step'
import { newestSessionRow, type AgentRow } from './agent-rows'

// One process per agent session (H10): where a session is held is a question about Orca's terminals,
// not only about Pilot's step rows. A tab Resume opened, another run's per_worktree session or one
// the person started by hand has no row of ours, but Orca's agent status rows name its session.
export type SessionTabs = (sessionId: string) => Promise<KnownTerminal[]>

type Listed = Awaited<ReturnType<OrcaRuntimeService['listTerminals']>>['terminals'][number]
const LIST_LIMIT = 10_000

function holdsSession(rows: readonly AgentRow[], sessionId: string): boolean {
  return newestSessionRow(rows)?.providerSession?.id === sessionId
}

// Every terminal whose newest provider-session row is this session, from the runtime's whole row table.
export function runtimeSessionTabs(runtime: OrcaRuntimeService): SessionTabs {
  return async (sessionId) => {
    const byPane = new Map<string, AgentRow[]>()
    for (const row of runtime.getAgentProviderSessionRows()) {
      byPane.set(row.paneKey, [...(byPane.get(row.paneKey) ?? []), row])
    }
    const panes = [...byPane].filter(([, rows]) => holdsSession(rows, sessionId))
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
    for (const [paneKey] of panes) {
      const terminal = listing.terminals.find(
        (t: Listed) =>
          t.connected && (`${t.tabId}:${t.leafId}` === paneKey || t.recordedPaneKey === paneKey)
      )
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
