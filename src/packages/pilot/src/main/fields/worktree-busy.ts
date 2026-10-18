import { worktreePathKey } from './agent-activity'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'

// Ports of worktree-gate/gate.py worktree_busy and tab_busy: why another agent can't start in a
// worktree now (someone typing in an agent tab there, or its agent hasn't finished).
export type BusyTerminal = {
  handle: string
  title: string | null
  connected: boolean
  agentIdentity: unknown
  worktreePath: string
  tabId: string
  leafId: string
}
export type BusyReads = {
  draft(handle: string): Promise<string>
  agentStates(): Promise<ReadonlyMap<string, string>>
  tabBusy(handle: string): Promise<boolean>
}
export type TabReads = {
  waitIdle(handle: string): Promise<boolean>
  orphaned(handle: string): Promise<boolean>
  screen(handle: string): Promise<readonly string[]>
}
export type BusyRuntime = Pick<
  OrcaRuntimeService,
  'listTerminals' | 'readTerminal' | 'getWorktreePs' | 'waitForTerminal' | 'showTerminal'
>

const UNFINISHED: Record<string, string> = {
  working: 'is working',
  waiting: 'is asking for input',
  blocked: 'is asking for input'
}
// Claude's spinner ("✽ Symbioting… (7m 39s") or Codex's footer: a turn still running on screen.
export const TURN_RUNNING = /^\s*\S \S+…|esc to interrupt/i
const LIST_LIMIT = 10_000
const PS_LIMIT = 1000
const IDLE_WAIT_MS = 1500

// gate.worktree_busy. An agent waiting on a background command shows an idle screen, so Orca's state
// (from its hooks) is read too; anything that can't be read counts as busy.
export async function worktreeBusy(
  path: string,
  terminals: readonly BusyTerminal[],
  reads: BusyReads,
  endedRunTerminal: (t: BusyTerminal) => boolean = () => false
): Promise<{ typing: boolean; reason: string } | null> {
  for (const t of terminals) {
    if (
      !t.connected ||
      !t.agentIdentity ||
      worktreePathKey(t.worktreePath) !== worktreePathKey(path)
    ) {
      continue
    }
    const name = t.title || t.handle
    try {
      // A finished run's leftover prompt isn't someone typing; its agent can still be busy.
      if (!endedRunTerminal(t) && (await reads.draft(t.handle))) {
        return { typing: true, reason: `someone is typing in ${name}` }
      }
      const state = (await reads.agentStates()).get(`${t.tabId}:${t.leafId}`)
      const unfinished = state && Object.hasOwn(UNFINISHED, state) ? UNFINISHED[state] : undefined
      if (unfinished) {
        return { typing: false, reason: `${name} ${unfinished}` }
      }
      if (await reads.tabBusy(t.handle)) {
        return { typing: false, reason: `${name} is working` }
      }
    } catch {
      return { typing: false, reason: `${name} could not be read` }
    }
  }
  return null
}

// gate.tab_busy: mid-turn unless Orca says the TUI is idle. A wait that fails says nothing, so the
// terminal decides: a live pane is busy (the safe answer); an orphaned one is busy while its screen
// shows a turn running. Anything unreadable is busy.
export async function tabBusy(handle: string, reads: TabReads): Promise<boolean> {
  try {
    return !(await reads.waitIdle(handle))
  } catch {
    // fall through to the terminal itself
  }
  try {
    if (!(await reads.orphaned(handle))) {
      return true
    }
    return (await reads.screen(handle)).some((line) => TURN_RUNNING.test(line))
  } catch {
    return true
  }
}

export async function listBusyTerminals(runtime: BusyRuntime): Promise<BusyTerminal[]> {
  const result = await runtime.listTerminals(undefined, LIST_LIMIT, { includeVisualLayouts: false })
  if (result.truncated) {
    throw new Error(`terminal list cut short (${result.totalCount} terminals)`)
  }
  return result.terminals.map((t) => ({
    handle: t.handle,
    title: t.title,
    connected: t.connected,
    agentIdentity: t.agentIdentity ?? null,
    worktreePath: t.worktreePath,
    tabId: t.tabId,
    leafId: t.leafId
  }))
}

// gate.agent_states: what each agent's hooks last told Orca, by pane key (`tabId:leafId`).
async function readAgentStates(runtime: BusyRuntime): Promise<ReadonlyMap<string, string>> {
  const ps = await runtime.getWorktreePs(PS_LIMIT)
  if (ps.truncated) {
    throw new Error(`worktree ps returned ${ps.worktrees.length} of ${ps.totalCount} worktrees`)
  }
  return new Map(ps.worktrees.flatMap((w) => w.agents.map((a) => [a.paneKey, a.state] as const)))
}

// One per pass: agent states are read once, the first time a worktree needs them.
export function runtimeBusyReads(runtime: BusyRuntime): BusyReads {
  let states: Promise<ReadonlyMap<string, string>> | null = null
  const tab: TabReads = {
    waitIdle: async (handle) =>
      (await runtime.waitForTerminal(handle, { condition: 'tui-idle', timeoutMs: IDLE_WAIT_MS }))
        .satisfied,
    orphaned: async (handle) => (await runtime.showTerminal(handle)).orphaned === true,
    screen: async (handle) => (await runtime.readTerminal(handle)).tail
  }
  return {
    // Typing is read with the screen read (B6): one line is enough to see a draft.
    draft: async (handle) =>
      (await runtime.readTerminal(handle, { screen: true, limit: 1 })).draft ?? '',
    agentStates: () => {
      states ??= readAgentStates(runtime)
      return states
    },
    tabBusy: (handle) => tabBusy(handle, tab)
  }
}
