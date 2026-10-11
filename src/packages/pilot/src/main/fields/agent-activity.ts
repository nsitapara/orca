import type { AgentState } from '../run/agent-rows'

export type { AgentState }
// A connected terminal running an agent. paneKey is `tabId:leafId`, as the hook rows key panes.
export type AgentTerminal = { handle: string; worktreePath: string; paneKey: string }
// null = couldn't be read; the idle check fails closed on it.
export type AgentActivity = { state: AgentState | null; typing: boolean | null }
export type ActivityDeps = {
  agentTerminals(): Promise<AgentTerminal[]>
  paneState(paneKey: string): AgentState
  terminalDraft(handle: string): Promise<string>
}

const RANK: Record<AgentState, number> = { idle: 0, waiting: 1, working: 2 }

async function terminalActivity(t: AgentTerminal, deps: ActivityDeps): Promise<AgentActivity> {
  let state: AgentState | null
  try {
    state = deps.paneState(t.paneKey)
  } catch {
    state = null
  }
  let typing: boolean | null
  try {
    typing = (await deps.terminalDraft(t.handle)).trim() !== ''
  } catch {
    typing = null
  }
  return { state, typing }
}

// Working is decisive; otherwise one unreadable tab makes the worktree unknown.
function combineStates(states: (AgentState | null)[]): AgentState | null {
  if (states.includes('working')) {
    return 'working'
  }
  let worst: AgentState = 'idle'
  for (const state of states) {
    if (state === null) {
      return null
    }
    if (RANK[state] > RANK[worst]) {
      worst = state
    }
  }
  return worst
}

function combineTyping(values: (boolean | null)[]): boolean | null {
  if (values.includes(true)) {
    return true
  }
  if (values.includes(null)) {
    return null
  }
  return false
}

// One terminal listing serves every worktree of a tick. A failed listing returns null: each
// worktree's agent state and typing stay unknown, so `worktree: idle` fails closed.
export async function worktreeActivity(
  paths: readonly string[],
  deps: ActivityDeps
): Promise<Map<string, AgentActivity> | null> {
  let terminals: AgentTerminal[]
  try {
    terminals = await deps.agentTerminals()
  } catch {
    return null
  }
  const out = new Map<string, AgentActivity>()
  for (const path of new Set(paths)) {
    const here = await Promise.all(
      terminals.filter((t) => t.worktreePath === path).map((t) => terminalActivity(t, deps))
    )
    out.set(path, {
      state: combineStates(here.map((a) => a.state)),
      typing: combineTyping(here.map((a) => a.typing))
    })
  }
  return out
}
