import type { ItemFields, RunRow, StepRow } from '../../shared/api-types'
import type { AutomationDefinition, StepDef } from '../../shared/definition/types'
import { decideStep, runEnd, type EndedStep, type RunEnd } from '../../shared/run/step-plan'
import { runFields, stepFields } from '../../shared/template'
import type { LaunchRequest } from '../scheduler/tick-runner'
import type { PilotStore } from '../store/store'
import { stepKindOf, type AdvancedStep } from '../store/store-advance'
import { resolveWorkspace, type WorkspaceDeps } from './workspace'

export type StepStartRequest = {
  run: RunRow
  definition: AutomationDefinition
  idx: number
  // The item's fields, then the run's workspace, run.* and steps.*/previous.*: what templates read.
  fields: ItemFields
}
// Starts one step and returns once it is under way. It writes the step's row ('starting', then
// 'running'), or takes over the 'pending' row the engine wrote, and throws when the step couldn't
// start. The step's end reaches RunEngine.advance.
export type StepStarter = (req: StepStartRequest) => Promise<void>
export type RunEngineDeps = {
  store: PilotStore
  now(): number
  definitionFor(automationId: string): AutomationDefinition | null
  startStep: StepStarter
  // What startRun hands Task 8b's resolveWorkspace.
  workspace: WorkspaceDeps
  log(message: string): void
  // Called once when a run reaches its end status (Task 24c applies answer runs' outputs here).
  onRunEnd?(run: RunRow, end: RunEnd): void
  // The answer text for {run.answer}: set for runs an answer starts, '' for a plain Approve, null
  // for any other run (Task 25 wires it).
  runAnswer?(run: RunRow): string | null
}
export type RunEngine = {
  // The tick runner's launch. Writes step 0 as pending, resolves and records the workspace, then
  // starts the steps. Throws when no step could start, so the tick runner releases the item's
  // once_per key (or keeps it for an UnrecordedLaunchError).
  startRun(req: LaunchRequest): Promise<void>
  // After a step ended: skip or start the next steps, or end the run. Never throws.
  advance(runId: string): Promise<void>
  // Running runs whose steps have all ended (Pilot quit between two steps, an advance that failed).
  advanceIdle(): Promise<void>
}

const OPEN_STEP: ReadonlySet<StepRow['status']> = new Set(['pending', 'starting', 'running'])

// Contract §7: the step's own timeout, else limits.timeout, else none.
export function stepTimeoutMs(def: AutomationDefinition, idx: number): number | null {
  return def.steps[idx]?.timeoutMs ?? def.limits.timeoutMs ?? null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function broke(status: StepRow['status'] | RunEnd['status']): boolean {
  return status === 'failed' || status === 'timed_out'
}

// An answer run's steps aren't in the definition, so `def` is null for it.
function endedSteps(rows: StepRow[], def: AutomationDefinition | null): EndedStep[] {
  return rows.map((r) => ({
    name: r.name,
    status: r.status,
    always: def?.steps[r.idx]?.always ?? false,
    error: r.error
  }))
}

// {run.failed} (H3): an earlier non-`always` step failed or timed out.
function runFailed(ended: EndedStep[]): boolean {
  return ended.some((s) => !s.always && broke(s.status))
}

// The run's own workspace wins over the item's: a new_worktree workspace exists only once startRun
// resolved it and recorded it on the run.
function workspaceFields(run: RunRow): ItemFields {
  const fields: ItemFields = {}
  if (run.worktreePath) {
    fields['worktree.path'] = run.worktreePath
  }
  if (run.worktreeId) {
    fields['worktree.id'] = run.worktreeId
  }
  return fields
}

function rowFor(runId: string, idx: number, step: StepDef, at: number): AdvancedStep {
  return {
    runId,
    idx,
    name: step.name,
    agent: step.agent,
    skill: step.skill,
    mode: step.mode,
    whenExpr: step.when,
    at
  }
}

// run.* as a template reads it, dated by the run's start in the automation's timezone.
function runFieldsOf(run: RunRow, def: AutomationDefinition): ItemFields {
  return runFields({
    automationId: run.automationId,
    at: run.startedAt,
    timezone: def.timezone,
    runId: run.id,
    tickId: run.tickId ?? undefined
  })
}

function nextIdx(rows: StepRow[]): number {
  return rows.reduce((max, r) => Math.max(max, r.idx + 1), 0)
}

export function createRunEngine(deps: RunEngineDeps): RunEngine {
  const { store } = deps
  const busy = new Set<string>()
  const again = new Set<string>()

  // An `always` step that failed or timed out doesn't fail the run (H3); its own row says so, and
  // this event does too.
  function recordCleanupFailures(run: RunRow, ended: EndedStep[]): void {
    for (const step of ended) {
      if (step.always && broke(step.status)) {
        store.events.add({
          at: deps.now(),
          kind: 'always_step_failed',
          automationId: run.automationId,
          runId: run.id,
          worktreePath: run.worktreePath,
          itemKey: run.itemKey,
          payload: { step: step.name, status: step.status, error: step.error }
        })
      }
    }
  }

  function close(run: RunRow, end: RunEnd, ended: EndedStep[] = []): void {
    const at = deps.now()
    const spent = store.advance.rollupCost(run.id)
    store.runs.update(run.id, {
      status: end.status,
      outcome: end.outcome,
      finishedAt: at,
      costUsd: spent.costUsd,
      tokens: spent.tokens
    })
    // The once_per key: a failed or timed-out run's key is failed (retry_after_failure), any other done.
    store.setHandledStatus(run.automationId, run.id, broke(end.status) ? 'failed' : 'done', at)
    recordCleanupFailures(run, ended)
    if (deps.onRunEnd) {
      try {
        deps.onRunEnd(store.runs.get(run.id) ?? run, end)
      } catch (error) {
        deps.log(`[pilot] run ${run.id}: onRunEnd failed: ${messageOf(error)}`)
      }
    }
  }

  function itemFieldsOf(run: RunRow): ItemFields {
    if (run.tickId === null) {
      return {}
    }
    return store.advance.tickItemFields(run.tickId, run.itemKey) ?? {}
  }

  function fieldsFor(
    run: RunRow,
    def: AutomationDefinition,
    base: ItemFields,
    rows: StepRow[],
    idx: number
  ): ItemFields {
    return {
      ...base,
      ...workspaceFields(run),
      ...runFieldsOf(run, def),
      ...stepFields(rows, idx),
      'run.failed': runFailed(endedSteps(rows, def)),
      'run.answer': deps.runAnswer?.(run) ?? null
    }
  }

  // A skipped step that startRun already wrote as pending is updated; any other gets a new row.
  function skipStep(
    rows: StepRow[],
    runId: string,
    idx: number,
    step: StepDef,
    reason: string
  ): void {
    const at = deps.now()
    if (rows.some((r) => r.idx === idx)) {
      store.runs.updateStep(runId, idx, { status: 'skipped', error: reason, finishedAt: at })
      return
    }
    store.advance.recordSkippedStep(rowFor(runId, idx, step, at), reason)
  }

  // Walks from the first step without a row (from step 0 when `opening`: startRun wrote it as
  // pending): skipped steps get a row and the walk goes on; the first step to run is started and the
  // walk stops until it ends. Past the last step, the run ends. An answer run has no definition
  // steps: it ends after its last recorded step.
  async function proceed(runId: string, item: ItemFields | null, opening: boolean): Promise<void> {
    let run = store.runs.get(runId)
    if (!run || run.status !== 'running') {
      return
    }
    let rows = store.runs.steps(runId)
    // No step yet: startRun hasn't written step 0, and only it resolves the run's workspace.
    if (!opening && (rows.length === 0 || rows.some((r) => OPEN_STEP.has(r.status)))) {
      return
    }
    const spent = store.advance.rollupCost(runId)
    store.runs.update(runId, { costUsd: spent.costUsd, tokens: spent.tokens })
    if (run.trigger === 'answer') {
      const ended = endedSteps(rows, null)
      close(run, runEnd(ended, store.inbox.openCountForRun(runId)), ended)
      return
    }
    const def = deps.definitionFor(run.automationId)
    if (!def) {
      close(run, {
        status: 'failed',
        outcome: `The automation ${run.automationId} is no longer loaded`
      })
      return
    }
    const drift = rows.find((r) => def.steps[r.idx]?.name !== r.name)
    if (drift) {
      close(run, {
        status: 'failed',
        outcome: `The automation's steps changed while this run was going; it stopped after step ${drift.name}`
      })
      return
    }
    const base = item ?? itemFieldsOf(run)
    const first = opening ? 0 : nextIdx(rows)
    for (let idx = first; idx < def.steps.length; idx += 1) {
      const step = def.steps[idx]
      const fields = fieldsFor(run, def, base, rows, idx)
      const verdict = decideStep(step, endedSteps(rows, def), fields)
      if (!verdict.run) {
        skipStep(rows, runId, idx, step, verdict.reason)
      } else {
        try {
          await deps.startStep({ run, definition: def, idx, fields })
          return
        } catch (error) {
          store.advance.ensureFailedStep(rowFor(runId, idx, step, deps.now()), messageOf(error))
          if (opening) {
            throw error
          }
          deps.log(`[pilot] run ${runId}: step ${step.name} couldn't start: ${messageOf(error)}`)
        }
      }
      rows = store.runs.steps(runId)
      run = store.runs.get(runId) ?? run
    }
    const ended = endedSteps(rows, def)
    close(run, runEnd(ended, store.inbox.openCountForRun(runId)), ended)
  }

  // Step 0 is written as pending first, so the stale-start sweep and the Agent Console see the run
  // while a slow new_worktree is being made (B8). The workspace is recorded on the run before any
  // step starts. The run must already be running: a new worktree's claim only sees running runs.
  async function open(req: LaunchRequest): Promise<void> {
    const run = store.runs.get(req.runId)
    if (!run) {
      throw new Error(`Run ${req.runId} doesn't exist`)
    }
    if (run.status !== 'running') {
      throw new Error(`Run ${run.id} is ${run.status}, not running`)
    }
    const first = req.definition.steps[0]
    store.runs.createStep({
      runId: run.id,
      idx: 0,
      name: first.name,
      agent: first.agent,
      skill: first.skill,
      kind: stepKindOf(first.agent),
      mode: first.mode,
      whenExpr: first.when,
      status: 'pending',
      startedAt: deps.now()
    })
    const fields: ItemFields = { ...req.decision.fields, ...runFieldsOf(run, req.definition) }
    try {
      const workspace = await resolveWorkspace(
        { definition: req.definition, runId: run.id, label: req.decision.label, fields },
        deps.workspace
      )
      store.runs.update(run.id, { worktreePath: workspace.path, worktreeId: workspace.worktreeId })
    } catch (error) {
      store.advance.ensureFailedStep(rowFor(run.id, 0, first, deps.now()), messageOf(error))
      throw error
    }
    await proceed(run.id, req.decision.fields, true)
  }

  // One walk per run at a time. A call that arrives meanwhile is replayed once the walk ends, unless
  // the walk threw: a run startRun couldn't start is the tick runner's to fail.
  async function locked(runId: string, work: () => Promise<void>): Promise<void> {
    if (busy.has(runId)) {
      again.add(runId)
      return
    }
    busy.add(runId)
    try {
      await work()
    } catch (error) {
      again.delete(runId)
      throw error
    } finally {
      busy.delete(runId)
      if (again.delete(runId)) {
        void engine.advance(runId)
      }
    }
  }

  const engine: RunEngine = {
    startRun: (req) => locked(req.runId, () => open(req)),
    advance: (runId) =>
      locked(runId, async () => {
        try {
          await proceed(runId, null, false)
        } catch (error) {
          deps.log(`[pilot] couldn't advance run ${runId}: ${messageOf(error)}`)
        }
      }),
    async advanceIdle() {
      let runs: RunRow[]
      try {
        runs = store.advance.runsAwaitingAdvance()
      } catch (error) {
        deps.log(`[pilot] couldn't list runs to advance: ${messageOf(error)}`)
        return
      }
      for (const run of runs) {
        await engine.advance(run.id)
      }
    }
  }
  return engine
}
