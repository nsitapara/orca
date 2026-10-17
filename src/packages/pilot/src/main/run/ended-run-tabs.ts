import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { StepRow } from '../../shared/api-types'
import type { PilotStore } from '../store/store'
import type { AgentRow } from './agent-rows'
import type { SessionTerminals } from './agent-step'
import { LIST_LIMIT } from './terminal-relist'

// Once every run on a tab has ended, however it ended, the tab closes: Resume reopens its session
// (`claude --resume`, `codex resume`), and an open one only holds `session: none_open` shut. A tab stays while it may be
// someone's: no session to resume, a turn begun after its last step (taken over), another session or no agent in it,
// someone typing, or a start on its session in flight.
export type EndedRunTabsDeps = {
  store: PilotStore
  // The connected terminals (a fresh PTY listing); null when the listing was cut short.
  openHandles(): Promise<ReadonlySet<string> | null>
  rowsOf(paneKey: string): readonly TurnRow[]
  terminals: Pick<SessionTerminals, 'state' | 'close' | 'claims'>
  log(message: string): void
}
export type EndedRunTabs = { pass(): Promise<void> }

type TurnRow = Pick<AgentRow, 'turnStartedAt' | 'stateStartedAt'>
type Resumable = StepRow & { sessionId: string; paneKey: string; finishedAt: number }

const STEP_LIVE: ReadonlySet<StepRow['status']> = new Set(['starting', 'running'])

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resumable(step: StepRow): step is Resumable {
  return step.sessionId !== null && step.paneKey !== null && step.finishedAt !== null
}

// A turn begun after the tab's last step ended: someone took the tab over, so it is theirs now.
function usedSince(rows: readonly TurnRow[], at: number): boolean {
  return rows.some((row) => (row.turnStartedAt ?? row.stateStartedAt) > at)
}

function byHandle(steps: readonly StepRow[]): Map<string, StepRow[]> {
  const out = new Map<string, StepRow[]>()
  for (const step of steps) {
    if (step.terminalHandle) {
      out.set(step.terminalHandle, [...(out.get(step.terminalHandle) ?? []), step])
    }
  }
  return out
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
      const state = await terminals.state({ handle, paneKey: step.paneKey }, step.sessionId)
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
      const open = await deps.openHandles()
      if (!open) {
        return
      }
      const steps = store.runs.stepsOnTerminals([...open].filter((h) => !kept.has(h)))
      const live = store.runs.liveAmong([...new Set(steps.map((s) => s.runId))])
      for (const [handle, onTab] of byHandle(steps)) {
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

export function runtimeOpenHandles(
  runtime: OrcaRuntimeService
): () => Promise<ReadonlySet<string> | null> {
  return async () => {
    const listing = await runtime.listTerminals(undefined, LIST_LIMIT, {
      requireFreshPtyLiveness: true,
      includeVisualLayouts: false
    })
    if (listing.truncated) {
      return null
    }
    return new Set(listing.terminals.filter((t) => t.connected).map((t) => t.handle))
  }
}
