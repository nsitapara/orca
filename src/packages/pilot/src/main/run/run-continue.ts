import type { ContinueRunResult, RunRow, StepRow } from '../../shared/api-types'
import { readsFed } from '../../shared/definition/jobs'
import type { AutomationDefinition } from '../../shared/definition/types'
import { isSessionId } from '../../shared/session-id'
import type { RunCapacity } from '../capacity/run-capacity'
import type { PilotStore } from '../store/store'
import type { ResumeStep, RunEngine } from './advance'
import type { AgentStepDeps } from './agent-step'
import { nextIdx } from './advance-fields'
import { addRunEvent } from './run-close'

export type ContinueRunDeps = {
  store: PilotStore
  now(): number
  definitionFor(automationId: string): AutomationDefinition | null
  // The run limit (main/capacity): a continued run takes a slot like any other.
  capacity: Pick<RunCapacity, 'hasFreeSlot'>
  // Whether a session's transcript is on disk: only then can its agent resume it.
  launcherDeps: Pick<AgentStepDeps, 'transcriptExists'>
  // The process's run engine (engine-wiring.ts).
  wired: { engine: Pick<RunEngine, 'continueRun'> }
}

const ENDED: ReadonlySet<RunRow['status']> = new Set(['failed', 'timed_out', 'cancelled'])
const BROKE: ReadonlySet<StepRow['status']> = new Set(['failed', 'timed_out', 'stopped'])

// The step a continued run goes on from: the first that broke, else the first it never reached; null past the last.
function startIdx(rows: StepRow[], def: AutomationDefinition): number | null {
  const broke = rows.find((r) => BROKE.has(r.status))
  if (broke) {
    return broke.idx
  }
  const next = nextIdx(rows)
  return next < def.steps.length ? next : null
}

// A context-preparation run goes on only while the card's preparation is still its to take, as at its launch.
function preparationRefusal(
  deps: ContinueRunDeps,
  run: RunRow,
  def: AutomationDefinition,
  from: number
): string | null {
  if (def.items?.kind !== 'inbox_preparation' || run.tickId === null) {
    return null
  }
  const revision = deps.store.advance.tickItemFields(run.tickId, run.itemKey)?.[
    'preparation.revision'
  ]
  if (typeof revision !== 'number') {
    return null
  }
  const refused = deps.store.inboxPreparations.claimRefusal(
    run.itemKey,
    revision,
    run.id,
    from,
    deps.now()
  )
  if (!refused) {
    return null
  }
  if (refused.nothingToDo) {
    return `Nothing to continue: ${refused.reason}`
  }
  return `Can't continue: ${refused.reason}`
}

// Why the run can't go on, or null. Nothing is written until every check passed.
function refusal(
  deps: ContinueRunDeps,
  run: RunRow,
  def: AutomationDefinition | null,
  from: number | null
): string | null {
  if (!ENDED.has(run.status)) {
    return `Run ${run.id} is ${run.status}: only a failed, timed-out or stopped run can be continued`
  }
  if (run.trigger === 'answer') {
    return "An answer run can't be continued: answer its card again"
  }
  if (!def) {
    return `The automation ${run.automationId} is no longer loaded`
  }
  if (def.workspace.kind === 'env') {
    return "A run in an env workspace can't be continued: its env was taken down when it ended"
  }
  if (readsFed(def)) {
    return 'The work handed over to this run went back to its queue when it failed: the next tick takes it up again'
  }
  const rows = deps.store.runs.steps(run.id)
  if (rows.some((r) => def.steps[r.idx]?.name !== r.name)) {
    return "The automation's steps changed since this run, so it can't be continued"
  }
  if (from === null) {
    return 'There is nothing left to continue: every step of this run finished'
  }
  const preparing = preparationRefusal(deps, run, def, from)
  if (preparing) {
    return preparing
  }
  const path = run.worktreePath
  const other = path ? deps.store.runs.runningInWorktree(path).find((r) => r.id !== run.id) : null
  if (other) {
    return `Run ${other.id} is working in ${path}: continue this run once it ends`
  }
  if (!deps.capacity.hasFreeSlot(def)) {
    return 'Every run slot is taken: continue this run once one frees'
  }
  return null
}

// The broken step's own agent session, when its agent can resume it; else the step starts over.
async function resumeOf(
  deps: ContinueRunDeps,
  run: RunRow,
  row: StepRow | undefined
): Promise<ResumeStep | null> {
  if (!row || (row.agent !== 'claude' && row.agent !== 'codex')) {
    return null
  }
  const { sessionId } = row
  if (!sessionId || !isSessionId(sessionId)) {
    return null
  }
  const startedAt = row.startedAt ?? run.startedAt
  const there = await deps.launcherDeps
    .transcriptExists(row.agent, sessionId, row.transcriptPath, startedAt)
    .catch(() => false)
  if (!there) {
    return null
  }
  const reason = row.error || run.outcome || 'it stopped before it finished'
  return { idx: row.idx, sessionId, reason }
}

// Continues a failed, timed-out or stopped run where it broke: the steps that finished keep their results, the step
// that broke goes again (in its own agent session when it can be resumed), and the run goes on from there as usual.
// Its once_per key is held again, so no tick starts a second run on the item meanwhile.
export async function continueRun(
  deps: ContinueRunDeps,
  runId: string
): Promise<ContinueRunResult> {
  const { store } = deps
  const run = store.runs.get(runId)
  if (!run) {
    throw new Error(`No run ${runId}`)
  }
  const def = deps.definitionFor(run.automationId)
  const rows = store.runs.steps(runId)
  const from = def ? startIdx(rows, def) : null
  const why = refusal(deps, run, def, from)
  if (why || !def || from === null) {
    throw new Error(why ?? `Run ${runId} can't be continued`)
  }
  const resume = await resumeOf(
    deps,
    run,
    rows.find((r) => r.idx === from)
  )
  const at = deps.now()
  store.transaction(() => {
    store.advance.reopenFrom(run.id, from, resume !== null, at)
    store.setHandledStatus(run.automationId, run.id, 'started', at)
  })
  const result = { step: def.steps[from].name, resumed: resume !== null }
  addRunEvent(store, at, run, 'run_continued', result)
  await deps.wired.engine.continueRun(run.id, resume)
  return result
}
