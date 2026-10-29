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

type LiveRowFields = Pick<AgentRow, 'receivedAt' | 'providerSessionOnly' | 'restoredUnconfirmed'>
type TurnOverFields = { state?: string; workingMode?: string; mainAgent?: { state: string } | null }

// Mirrors upstream's selectRuntimeHookAgentRowForPane "live" rule: newest by receivedAt, ignoring
// provider-session-only and restored-unconfirmed rows (neither proves the agent is live).
export function newestLiveRow<R extends LiveRowFields>(rows: readonly R[]): R | null {
  let best: R | null = null
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
// nothing. Without a main agent, or with one not done, the turn still runs. Accepted: for about 100 ms (up to a 60 s
// lease) after a Claude task ends its wake-up turn is owed (claudeTaskWakeupPending), which worktree ps rows don't
// carry, so only the step watcher excludes it. Reasoned for Claude: Grok's still-active stop hook also reads monitoring
// after its turn ends, and can resume that turn (Pilot runs no Grok).
export function turnOver(row: TurnOverFields): boolean {
  return (
    row.state === 'working' && row.workingMode === 'monitoring' && row.mainAgent?.state === 'done'
  )
}

// A turn over's tab, read off the pane's newest live row: closing it would end the background work it left.
export function backgroundWorkRuns(rows: readonly (LiveRowFields & TurnOverFields)[]): boolean {
  const row = newestLiveRow(rows)
  return row !== null && turnOver(row)
}

export function observedState(row: AgentRow): ObservedState {
  // Claude's SessionStart writes done + sessionBoundary before the prompt lands: not a turn end.
  if (row.state === 'done' && row.sessionBoundary === true) {
    return 'working'
  }
  return STATE_MAP[row.state] ?? 'working'
}

// No live row: nothing runs in the pane, or its agent has no hooks; both read as idle, as a turn over does.
export function paneStateFromRows(rows: readonly AgentRow[]): AgentState {
  const row = newestLiveRow(rows)
  if (!row || turnOver(row)) {
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
