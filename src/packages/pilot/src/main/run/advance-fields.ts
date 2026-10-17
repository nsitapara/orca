import type { ItemFields, RunRow, StepRow } from '../../shared/api-types'
import type { AutomationDefinition, StepDef } from '../../shared/definition/types'
import type { EndedStep, RunEnd } from '../../shared/run/step-plan'
import { runFields, stepFields } from '../../shared/template'
import type { AdvancedStep } from '../store/store-advance'

// What a step's templates and `when` read (contract §4), assembled by the run engine.
export type StepInput = {
  run: RunRow
  def: AutomationDefinition
  // The item's fields as its tick decided them.
  item: ItemFields
  // The run's step rows so far, by idx.
  rows: StepRow[]
  idx: number
  // {run.answer}: the answer text for runs an answer starts, else null (R-2).
  answer: string | null
  // {run.choice}: the label of the option that started an ask-first run, '' for any other.
  choice?: string
}

// A step's row as the run engine writes it (pending, skipped or failed).
export function rowFor(runId: string, idx: number, step: StepDef, at: number): AdvancedStep {
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

// The first step index without a row.
export function nextIdx(rows: StepRow[]): number {
  return rows.reduce((max, r) => Math.max(max, r.idx + 1), 0)
}

export function broke(status: StepRow['status'] | RunEnd['status']): boolean {
  return status === 'failed' || status === 'timed_out'
}

// An answer run's steps aren't in the definition, so `def` is null for it.
export function endedSteps(rows: StepRow[], def: AutomationDefinition | null): EndedStep[] {
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

// An env run's facts as templates read them: {env.mode}, {env.path} (the folder it works in), … (README: Job environments).
function envFields(run: RunRow): ItemFields {
  const env = run.env
  if (!env) {
    return {}
  }
  return {
    'env.mode': env.mode,
    'env.reason': env.reason,
    'env.path': env.path,
    'env.sha': env.sha,
    'env.file': env.envFile,
    'env.stack': env.stack?.kind ?? null
  }
}

// The run's own workspace wins over the item's (a new_worktree exists only once startRun made it). For an env run,
// {worktree.path} stays the item's worktree, its home (job 05's flag step flags Nish's worktree with it); the folder the
// steps work in is {env.path}. The id is the run's only when it works in its home (in place, kept).
function workspaceFields(run: RunRow): ItemFields {
  const fields: ItemFields = {}
  const home = run.homePath ?? run.worktreePath
  if (home) {
    fields['worktree.path'] = home
  }
  const inHome = !run.homePath || run.homePath === run.worktreePath
  if (run.worktreeId && inHome) {
    fields['worktree.id'] = run.worktreeId
  }
  return { ...fields, ...envFields(run) }
}

// run.* as a template reads it, dated by the run's start in the automation's timezone.
export function runFieldsOf(run: RunRow, def: AutomationDefinition): ItemFields {
  return runFields({
    automationId: run.automationId,
    at: run.startedAt,
    timezone: def.timezone,
    runId: run.id,
    tickId: run.tickId ?? undefined
  })
}

// The item's fields, then the run's workspace, run.*, steps.*/previous.*, {run.failed}, {run.answer} and
// {run.choice}.
export function stepInputFields(input: StepInput): ItemFields {
  const { run, def, rows, idx } = input
  return {
    ...input.item,
    ...workspaceFields(run),
    ...runFieldsOf(run, def),
    ...stepFields(rows, idx),
    'run.failed': runFailed(endedSteps(rows, def)),
    'run.answer': input.answer,
    'run.choice': input.choice ?? ''
  }
}
