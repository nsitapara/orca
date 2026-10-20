import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { StepRow } from '../../shared/api-types'
import type { PilotStore } from '../store/store'
import type { AgentRow } from './agent-rows'
import type { SessionTerminals } from './agent-step'
import type { BusyTerminal } from '../fields/worktree-busy'
import { LIST_LIMIT, type Listed } from './terminal-relist'

// Once every run on a tab has ended, however it ended, the tab closes: Resume reopens its session
// (`claude --resume`, `codex resume`), and an open one only holds `session: none_open` shut. A tab stays while it may be
// someone's: no session to resume, a turn begun after its last step (taken over), another session or no agent in it,
// someone typing, or a start on its session in flight.
export type EndedRunTabsDeps = {
  store: PilotStore
  // The connected terminals (a fresh PTY listing); null when the listing was cut short.
  openTerminals(): Promise<OpenTerminal[] | null>
  rowsOf(paneKey: string): readonly TurnRow[]
  terminals: Pick<SessionTerminals, 'state' | 'close' | 'claims'>
  log(message: string): void
}
export type EndedRunTabs = { pass(): Promise<void> }
// A restart can give a pane's terminal a new handle, so a step's tab is found by its handle or its pane.
export type OpenTerminal = { handle: string; paneKeys: readonly string[] }

export type TurnRow = Pick<
  AgentRow,
  'turnStartedAt' | 'stateStartedAt' | 'state' | 'sessionBoundary'
>
type Resumable = StepRow & { sessionId: string; paneKey: string; finishedAt: number }

const STEP_LIVE: ReadonlySet<StepRow['status']> = new Set(['starting', 'running'])

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resumable(step: StepRow): step is Resumable {
  return step.sessionId !== null && step.paneKey !== null && step.finishedAt !== null
}

// A turn begun after the tab's last step ended: someone took the tab over, so it is theirs now. A session boundary (a
// resume or reconnect landing idle, as after a restart) is no turn.
function usedSince(rows: readonly TurnRow[], at: number): boolean {
  return rows.some(
    (row) =>
      !(row.state === 'done' && row.sessionBoundary === true) &&
      (row.turnStartedAt ?? row.stateStartedAt) > at
  )
}

function lastTurnStart(rows: readonly TurnRow[]): number | undefined {
  const starts = rows.flatMap((row) => (row.turnStartedAt === undefined ? [] : [row.turnStartedAt]))
  return starts.length > 0 ? Math.max(...starts) : undefined
}

function stepsOn(t: OpenTerminal, steps: readonly StepRow[]): StepRow[] {
  return steps.filter(
    (s) => s.terminalHandle === t.handle || (s.paneKey !== null && t.paneKeys.includes(s.paneKey))
  )
}

// Whether a listed terminal is one of Pilot's whose every recorded run has ended, found as the closer finds it. Its
// leftover draft is then no one's typing (a greyed suggestion), so the busy read ignores it.
export function endedRunTerminals(
  store: PilotStore,
  terminals: readonly BusyTerminal[],
  rowsOf: EndedRunTabsDeps['rowsOf']
): (t: BusyTerminal) => boolean {
  const open = terminals.map((t) => ({ handle: t.handle, paneKeys: paneKeysOf(t) }))
  const steps = store.runs.stepsOnTerminals(
    open.map((t) => t.handle),
    open.flatMap((t) => t.paneKeys)
  )
  const live = store.runs.liveAmong([...new Set(steps.map((s) => s.runId))])
  const ended = new Set(
    open
      .filter((t) => {
        const onTab = stepsOn(t, steps)
        const last = onTab.at(-1)
        // A turn begun after the last step ended means someone took the tab over, as the closer reads it.
        return (
          last !== undefined &&
          last.paneKey !== null &&
          last.finishedAt !== null &&
          !onTab.some((s) => live.has(s.runId) || STEP_LIVE.has(s.status)) &&
          !usedSince(rowsOf(last.paneKey), last.finishedAt)
        )
      })
      .map((t) => t.handle)
  )
  return (t) => ended.has(t.handle)
}

export function createEndedRunTabs(deps: EndedRunTabsDeps): EndedRunTabs {
  const { store, terminals } = deps
  // Tabs this process leaves open for good: unresumable, taken over, or no longer running the step's session.
  const kept = new Set<string>()

  // Under the session's claim, so no launch, Resume or answer can send into the tab while it closes.
  async function closeIfFree(handle: string, step: Resumable): Promise<void> {
    const { claims } = terminals
    const by = `close-ended:${handle}`
    if (claims) {
      await claims.expireIfSeen(step.sessionId)
      if (!claims.acquire(step.sessionId, by).ok) {
        return
      }
    }
    try {
      // The agent's leftover suggestion reads as a draft; the last turn's start tells it from typing.
      const state = await terminals.state({ handle, paneKey: step.paneKey }, step.sessionId, {
        turnStartedAt: lastTurnStart(deps.rowsOf(step.paneKey))
      })
      if (state === 'other' || state === 'gone') {
        kept.add(handle)
      }
      if (state !== 'free') {
        return
      }
      await terminals.close(handle)
      deps.log(`[pilot] run ${step.runId}: closed its ended tab ${handle}`)
    } finally {
      claims?.release(step.sessionId, by)
    }
  }

  return {
    async pass() {
      const listed = await deps.openTerminals()
      if (!listed) {
        return
      }
      const open = listed.filter((t) => !kept.has(t.handle))
      const steps = store.runs.stepsOnTerminals(
        open.map((t) => t.handle),
        open.flatMap((t) => t.paneKeys)
      )
      const live = store.runs.liveAmong([...new Set(steps.map((s) => s.runId))])
      for (const t of open) {
        const { handle } = t
        const onTab = stepsOn(t, steps)
        if (onTab.length === 0) {
          continue
        }
        if (onTab.some((s) => live.has(s.runId) || STEP_LIVE.has(s.status))) {
          continue
        }
        // Ordered by start: the last is the step that used the tab last.
        const last = onTab.at(-1)
        if (!last || !resumable(last) || usedSince(deps.rowsOf(last.paneKey), last.finishedAt)) {
          kept.add(handle)
          continue
        }
        try {
          await closeIfFree(handle, last)
        } catch (error) {
          deps.log(
            `[pilot] run ${last.runId}: couldn't close its tab ${handle}: ${messageOf(error)}`
          )
        }
      }
    }
  }
}

// The panes a listed terminal sits in, as terminal-relist.ts's inPane reads them.
function paneKeysOf(t: Pick<Listed, 'tabId' | 'leafId' | 'recordedPaneKey'>): string[] {
  const keys = t.tabId && t.leafId ? [`${t.tabId}:${t.leafId}`] : []
  return t.recordedPaneKey ? [...keys, t.recordedPaneKey] : keys
}

export function runtimeOpenTerminals(
  runtime: OrcaRuntimeService
): () => Promise<OpenTerminal[] | null> {
  return async () => {
    const listing = await runtime.listTerminals(undefined, LIST_LIMIT, {
      requireFreshPtyLiveness: true,
      includeVisualLayouts: false
    })
    if (listing.truncated) {
      return null
    }
    return listing.terminals
      .filter((t) => t.connected)
      .map((t) => ({ handle: t.handle, paneKeys: paneKeysOf(t) }))
  }
}
