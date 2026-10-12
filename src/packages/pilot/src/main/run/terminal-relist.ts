import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'

// Errors showTerminal throws for a terminal it can't find (throw sites in src/main/runtime):
// - terminal_handle_stale: build-pty-terminal-summary, resolve-terminal-pane (showTerminal) and others.
//   An unknown or pre-restart handle throws it too, so on its own it doesn't prove the terminal closed.
// - terminal_unsupported_for_agent_session: structured-worker-terminal-refusal, carried as `code`
//   (the message is prose). Only structured-worker handles throw it, and one can't be our terminal.
// - terminal_not_found: resolve-terminal-pane, serialize-main-terminal-buffer
// Anything else (runtime_unavailable during startup or a renderer reload, unknown errors) is
// transient: callers rethrow it and know nothing this time.
const GONE_CODES = new Set([
  'terminal_handle_stale',
  'terminal_unsupported_for_agent_session',
  'terminal_not_found'
])

export function isTerminalGoneError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const code = (error as { code?: unknown }).code
  return GONE_CODES.has(error.message) || (typeof code === 'string' && GONE_CODES.has(code))
}

// Second opinion on a terminal that showTerminal can't find: is it still alive?
export type TerminalRelist = (handle: string, paneKey: string | null) => Promise<boolean>

export type Listed = Awaited<ReturnType<OrcaRuntimeService['listTerminals']>>['terminals'][number]

export const LIST_LIMIT = 10_000
// One listing serves every lookup in a tick or a poll: each one refreshes the whole PTY inventory.
export const RELIST_REUSE_MS = 5_000

// A connected terminal that sits in this pane.
export function inPane(t: Listed, paneKey: string): boolean {
  return t.connected && (`${t.tabId}:${t.leafId}` === paneKey || t.recordedPaneKey === paneKey)
}

function sameTerminal(t: Listed, handle: string, paneKey: string | null): boolean {
  if (!t.connected) {
    return false
  }
  if (t.handle === handle) {
    return true
  }
  if (paneKey === null) {
    return false
  }
  return inPane(t, paneKey)
}

// Why: after an app restart the runtime's handle map is empty, so showTerminal reports a terminal the
// daemon still hosts as terminal_handle_stale. A listing with fresh liveness reads the PTY host's own
// inventory, re-adopts the handle each PTY was spawned with (ORCA_TERMINAL_HANDLE, see
// adoptControllerTerminalHandle) and restores its pane, so a live agent is found again under its old
// handle or in its old pane (`tabId:leafId`). Throws when liveness can't be proven
// (terminal_liveness_unavailable, runtime not ready): the caller then knows nothing either way.
export function terminalRelister(
  runtime: OrcaRuntimeService,
  now: () => number = Date.now
): TerminalRelist {
  let cached: { at: number; terminals: Promise<Listed[]> } | null = null
  const list = (): Promise<Listed[]> => {
    if (cached && now() - cached.at < RELIST_REUSE_MS) {
      return cached.terminals
    }
    const terminals = runtime
      .listTerminals(undefined, LIST_LIMIT, {
        requireFreshPtyLiveness: true,
        includeVisualLayouts: false
      })
      .then((r) => {
        if (r.truncated) {
          throw new Error(`terminal list cut short (${r.totalCount} terminals)`)
        }
        return r.terminals
      })
    const entry = { at: now(), terminals }
    cached = entry
    // A failed listing is never reused: the next lookup asks again.
    terminals.catch(() => {
      if (cached === entry) {
        cached = null
      }
    })
    return terminals
  }
  return async (handle, paneKey) => (await list()).some((t) => sameTerminal(t, handle, paneKey))
}
