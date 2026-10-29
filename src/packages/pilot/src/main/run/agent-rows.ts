import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'

export type ObservedState = 'working' | 'waiting' | 'done' | 'gone'
export type AgentRow = ReturnType<OrcaRuntimeService['getAgentStatusRowsForPane']>[number]
// What the worktree facts call an agent: idle (no turn running), working, or waiting for input.
export type AgentState = 'idle' | 'working' | 'waiting'

const STATE_MAP: Record<string, ObservedState> = {
  working: 'working',
  blocked: 'waiting',
  waiting: 'waiting',
  done: 'done'
}

// Mirrors upstream's selectRuntimeHookAgentRowForPane "live" rule: newest by receivedAt, ignoring
// provider-session-only and restored-unconfirmed rows (neither proves the agent is live).
export function newestLiveRow(rows: readonly AgentRow[]): AgentRow | null {
  let best: AgentRow | null = null
  for (const row of rows) {
    if (row.providerSessionOnly === true || row.restoredUnconfirmed === true) {
      continue
    }
    if (!best || row.receivedAt > best.receivedAt) {
      best = row
    }
  }
  return best
}

export function newestSessionRow(rows: readonly AgentRow[]): AgentRow | null {
  let best: AgentRow | null = null
  for (const row of rows) {
    if (row.providerSession && (!best || row.receivedAt > best.receivedAt)) {
      best = row
    }
  }
  return best
}

// 2026-10-29: background watchers and stale monitoring rows held answers and merge backs for hours. A turn that ended
// leaving only background shells or Monitor watchers reads working + monitoring with its main agent done: it holds
// nothing. Without a main agent, or with one not done, the turn still runs.
export function turnOver(row: {
  state?: string
  workingMode?: string
  mainAgent?: { state: string } | null
}): boolean {
  return (
    row.state === 'working' && row.workingMode === 'monitoring' && row.mainAgent?.state === 'done'
  )
}

export function observedState(row: AgentRow): ObservedState {
  // Claude's SessionStart writes done + sessionBoundary before the prompt lands: not a turn end.
  if (row.state === 'done' && row.sessionBoundary === true) {
    return 'working'
  }
  return STATE_MAP[row.state] ?? 'working'
}

// No live row: nothing runs in the pane, or its agent has no hooks; both read as idle.
export function paneStateFromRows(rows: readonly AgentRow[]): AgentState {
  const row = newestLiveRow(rows)
  if (!row) {
    return 'idle'
  }
  const state = observedState(row)
  if (state === 'working') {
    return 'working'
  }
  if (state === 'waiting') {
    return 'waiting'
  }
  return 'idle'
}
