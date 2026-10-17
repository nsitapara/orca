import type { ItemFields, RunRow, StepRow } from '../../shared/api-types'
import type { AutomationDefinition, StepDef } from '../../shared/definition/types'
import { decideStep, runEnd, type RunEnd } from '../../shared/run/step-plan'
import { usesHandled } from '../../shared/tick/decide'
import type { EnvPreparer } from '../envs/prepare'
import { UnrecordedLaunchError, type LaunchRequest } from '../scheduler/tick-runner'
import type { PilotStore } from '../store/store'
import { stepKindOf } from '../store/store-advance'
import { envHooks, type OpeningWalk } from './advance-env'
import { endedSteps, nextIdx, rowFor, runFieldsOf, stepInputFields } from './advance-fields'
import { addRunEvent, closeRun, type CloseOptions, type RunEndHandover } from './run-close'
import { resolveWorkspace, type WorkspaceDeps } from './workspace'

export { ANSWER_STEP_TIMEOUT_MS, runStepTimeoutMs, stepTimeoutMs } from './step-timeouts'

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
  // What a stage's run hands the next stage, written in the transaction that ends it (main/handover).
  handover?: RunEndHandover
  // The answer text for {run.answer}: set for runs an answer starts, '' for a plain Approve, null
  // for any other run (Task 25 wires it).
  runAnswer?(run: RunRow): string | null
  // The label of the option that started an ask-first run, for {run.choice}; '' for any other run.
  runChoice?(run: RunRow): string
  // Env workspaces (main/envs): records the run as preparing and makes its env off the tick.
  envs?: EnvPreparer
}
export type RunEngine = {
  // The tick runner's launch. Writes step 0 as pending, resolves and records the workspace, then
  // starts the steps. Throws when no step could start, so the tick runner releases the item's
  // once_per key (or keeps it for an UnrecordedLaunchError). An env workspace is made off the tick:
  // startRun returns once it is under way, and the run's env hooks start or end it (advance-env.ts).
  startRun(req: LaunchRequest): Promise<void>
  // After a step ended: skip or start the next steps, or end the run. Never throws.
  advance(runId: string): Promise<void>
  // Running runs whose steps have all ended (Pilot quit between two steps, an advance that failed).
  advanceIdle(): Promise<void>
}

const OPEN_STEP: ReadonlySet<StepRow['status']> = new Set(['pending', 'starting', 'running'])

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createRunEngine(deps: RunEngineDeps): RunEngine {
  const { store } = deps
  const busy = new Set<string>()
  const again = new Set<string>()
  // Each run's item fields and once_per key as its tick decided them. The tick records the fields
  // (tick_items) only once every run it starts has launched, so a run reads that record only after a
  // restart; the key isn't recorded on the run at all.
  const items = new Map<string, { fields: ItemFields; onceKey: string }>()

  function close(run: RunRow, end: RunEnd, opts: CloseOptions = {}): void {
    items.delete(run.id)
    closeRun(deps, run, end, opts)
  }

  function itemFieldsOf(run: RunRow): ItemFields {
    const known = items.get(run.id)
    if (known) {
      return known.fields
    }
    if (run.tickId === null) {
      return {}
    }
    return store.advance.tickItemFields(run.tickId, run.itemKey) ?? {}
  }

  // A skipped step that startRun already wrote as pending is updated; any other gets a new row.
  function skipStep(runId: string, idx: number, step: StepDef, reason: string): void {
    const at = deps.now()
    if (store.runs.steps(runId).some((r) => r.idx === idx)) {
      store.runs.updateStep(runId, idx, { status: 'skipped', error: reason, finishedAt: at })
      return
    }
    store.advance.recordSkippedStep(rowFor(runId, idx, step, at), reason)
  }

  // An agent runs in a terminal no step tracks. Nothing more starts beside it, not even an `always`
  // step; the run fails, and its key is settled done so no tick retries the item while it runs.
  function orphaned(
    runId: string,
    def: AutomationDefinition,
    idx: number,
    error: UnrecordedLaunchError
  ): void {
    const reason = `Not run: an untracked agent is still in terminal ${error.terminalHandle}`
    for (let later = idx + 1; later < def.steps.length; later += 1) {
      skipStep(runId, later, def.steps[later], reason)
    }
    const run = store.runs.get(runId)
    if (!run) {
      return
    }
    const payload = {
      step: def.steps[idx].name,
      terminal: error.terminalHandle,
      error: error.message
    }
    addRunEvent(store, deps.now(), run, 'orphan_agent', payload)
    holdKey(run, def)
    if (run.status !== 'running') {
      store.setHandledStatus(run.automationId, run.id, 'done', deps.now())
      return
    }
    const ended = endedSteps(store.runs.steps(runId), def)
    close(run, { status: 'failed', outcome: error.message }, { ended, handled: 'done' })
  }

  // True when the walk goes on past this step: it couldn't start, and the run is still running.
  async function start(
    run: RunRow,
    def: AutomationDefinition,
    idx: number,
    fields: ItemFields,
    opening: boolean
  ): Promise<boolean> {
    try {
      await deps.startStep({ run, definition: def, idx, fields })
      return false
    } catch (error) {
      store.advance.ensureFailedStep(
        rowFor(run.id, idx, def.steps[idx], deps.now()),
        messageOf(error)
      )
      if (error instanceof UnrecordedLaunchError) {
        orphaned(run.id, def, idx, error)
      }
      if (opening) {
        throw error
      }
      deps.log(
        `[pilot] run ${run.id}: step ${def.steps[idx].name} couldn't start: ${messageOf(error)}`
      )
      // The stale-start sweep may have closed the run during a slow launch: its outcome stands.
      return (
        !(error instanceof UnrecordedLaunchError) && store.runs.get(run.id)?.status === 'running'
      )
    }
  }

  // Walks from the first step without a row (from step 0 when `opening`: startRun wrote it as
  // pending): skipped steps get a row and the walk goes on; the first step to run is started and the
  // walk stops until it ends. Past the last step, the run ends. An answer run has no definition
  // steps: it ends after its last recorded step.
  async function proceed(runId: string, opening: boolean): Promise<void> {
    let run = store.runs.get(runId)
    if (!run || run.status !== 'running') {
      items.delete(runId)
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
      close(run, runEnd(ended, store.inbox.openCountForRun(runId)), { ended })
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
    const item = itemFieldsOf(run)
    for (let idx = opening ? 0 : nextIdx(rows); idx < def.steps.length; idx += 1) {
      const step = def.steps[idx]
      const answer = deps.runAnswer?.(run) ?? null
      const choice = deps.runChoice?.(run) ?? ''
      const fields = stepInputFields({ run, def, item, rows, idx, answer, choice })
      const verdict = decideStep(step, endedSteps(rows, def), fields)
      if (!verdict.run) {
        skipStep(runId, idx, step, verdict.reason)
      } else if (!(await start(run, def, idx, fields, opening))) {
        return
      }
      rows = store.runs.steps(runId)
      run = store.runs.get(runId) ?? run
    }
    const ended = endedSteps(rows, def)
    close(run, runEnd(ended, store.inbox.openCountForRun(runId)), { ended })
  }

  // The stale-start sweep frees a run's key (unmarkHandledForRun) when it closes a slow launch, which
  // is when an agent most often shows up untracked: mark the key again, as the tick runner's
  // keepOrphanHandled does at step 0, so no tick starts a second agent on the item. A run-once
  // automation without once_per holds no key; after a restart the key is unknown, and only a row the
  // sweep left can be settled.
  function holdKey(run: RunRow, def: AutomationDefinition): void {
    const onceKey = items.get(run.id)?.onceKey
    if (onceKey !== undefined && usesHandled(def)) {
      store.markHandled(run.automationId, onceKey, run.id, deps.now())
    }
  }

  // The opening walk returned or threw without handing step 0 to the starter (the automation was
  // unloaded, its steps changed, the run ended while its workspace was made, or a read failed). A
  // pending step 0 would read as still being opened, and the stale-start sweep never closes pending
  // rows (B8). A step 0 the starter took over, or that was skipped, is left alone.
  function settleUnstarted(runId: string, thrown?: string): void {
    if (store.runs.steps(runId).find((s) => s.idx === 0)?.status !== 'pending') {
      return
    }
    const error =
      thrown ?? store.runs.get(runId)?.outcome ?? 'The run ended before its first step started'
    store.runs.updateStep(runId, 0, { status: 'failed', error, finishedAt: deps.now() })
  }

  // Not `opening`: proceed() has a parameter of that name.
  const walker: OpeningWalk = { walk: walkOpened, locked, close }

  // The workspace is recorded on the run before any step starts; an env one is made off the tick (true: return now).
  // An env that can't even be asked for (a subject field with no value, a stack field that names no stack) fails the
  // run through its normal end, so retry_after_failure spaces the retries (Ruling P1); nothing is claimed or made.
  async function placeRun(run: RunRow, req: LaunchRequest, fields: ItemFields): Promise<boolean> {
    const ws = req.definition.workspace
    if (ws.kind !== 'env') {
      const workspace = await resolveWorkspace(
        { definition: req.definition, runId: run.id, label: req.decision.label, fields },
        deps.workspace
      )
      store.runs.update(run.id, { worktreePath: workspace.path, worktreeId: workspace.worktreeId })
      return false
    }
    const hooks = envHooks(deps, walker, run.id)
    try {
      if (!deps.envs) {
        throw new Error("This process can't make env workspaces")
      }
      const prepare = { run, env: ws, repo: req.definition.repo, label: req.decision.label, fields }
      deps.envs.begin(prepare, hooks)
    } catch (error) {
      hooks.end({ status: 'failed', outcome: messageOf(error) }, {})
    }
    return true
  }

  async function walkOpened(runId: string): Promise<void> {
    try {
      await proceed(runId, true)
    } catch (error) {
      settleUnstarted(runId, messageOf(error))
      throw error
    }
    settleUnstarted(runId)
  }

  // Step 0 is written as pending first, so the stale-start sweep and Activity see the run
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
    items.set(run.id, { fields: req.decision.fields, onceKey: req.decision.onceKey })
    const fields: ItemFields = { ...req.decision.fields, ...runFieldsOf(run, req.definition) }
    try {
      if (await placeRun(run, req, fields)) {
        return
      }
    } catch (error) {
      store.advance.ensureFailedStep(rowFor(run.id, 0, first, deps.now()), messageOf(error))
      throw error
    }
    await walkOpened(run.id)
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
      items.delete(runId)
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
          await proceed(runId, false)
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
