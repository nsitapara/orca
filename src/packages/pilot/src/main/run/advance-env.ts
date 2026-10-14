import type { RunRow } from '../../shared/api-types'
import type { RunEnd } from '../../shared/run/step-plan'
import type { PreparedHooks } from '../envs/prepare'
import { UnrecordedLaunchError } from '../scheduler/tick-runner'
import type { PilotStore } from '../store/store'
import type { CloseOptions } from './run-close'

// What the engine lends the env phase: its opening walk, its one-walk-per-run lock and its close.
export type OpeningWalk = {
  walk(runId: string): Promise<void>
  locked(runId: string, work: () => Promise<void>): Promise<void>
  close(run: RunRow, end: RunEnd, opts?: CloseOptions): void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// The run engine's side of "Preparing workspace" (main/envs): ready walks the steps as startRun would have; end closes a
// run whose env never came, settling its pending step 0 (skipped when deferred, failed otherwise).
export function envHooks(
  deps: { store: PilotStore; now(): number },
  engine: OpeningWalk,
  runId: string
): PreparedHooks {
  const { store } = deps
  return {
    ready: () =>
      engine.locked(runId, async () => {
        // Preparing isn't step time: the first step's timeout counts from now (a shell step keeps the pending row's start).
        store.runs.updateStep(runId, 0, { startedAt: deps.now() })
        try {
          await engine.walk(runId)
        } catch (error) {
          const run = store.runs.get(runId)
          if (run?.status === 'running' && !(error instanceof UnrecordedLaunchError)) {
            const end: RunEnd = { status: 'failed', outcome: `Couldn't start: ${messageOf(error)}` }
            engine.close(run, end, { release: true })
          }
        }
      }),
    end: (end, opts) => {
      const run = store.runs.get(runId)
      if (run?.status === 'running') {
        engine.close(run, end, opts)
      }
      if (store.runs.steps(runId).find((s) => s.idx === 0)?.status === 'pending') {
        const status = end.status === 'cancelled' ? 'skipped' : 'failed'
        store.runs.updateStep(runId, 0, { status, error: end.outcome, finishedAt: deps.now() })
      }
    }
  }
}
