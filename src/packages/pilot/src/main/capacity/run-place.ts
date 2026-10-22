import type { RunRow, StepRow } from '../../shared/api-types'
import type { HomeStep, RunHome, RunPlace } from '../../shared/api-types-capacity'
import type { AutomationDefinition } from '../../shared/definition/types'
import { strandedLine } from '../../shared/env-text'

// Where the run works, as its env chose; null for a run without an env or one still preparing.
export function runPlace(run: Pick<RunRow, 'env'>): RunPlace | null {
  const env = run.env
  if (!env?.mode) {
    return null
  }
  return { mode: env.mode, reason: env.reason || null, stack: env.stack !== null }
}

function homeStep(step: StepRow | undefined): HomeStep | undefined {
  if (!step?.result) {
    return undefined
  }
  return { ok: step.result.outcome === 'ok', reason: step.result.reason || null }
}

// What the run brought home, from the pilotcli results of its push and its hold_home merge back (a step its `when` skipped
// has none), the branch env delete kept a throwaway's commits on, and a throwaway it couldn't remove that holds work
// nothing else has. Null when there's nothing to say.
export function runHome(
  run: Pick<RunRow, 'env'> & { steps: readonly StepRow[] },
  def: AutomationDefinition | undefined
): RunHome | null {
  const homeSteps = new Set(def?.steps.filter((s) => s.holdHome).map((s) => s.name) ?? [])
  const pushed = homeStep(run.steps.find((s) => s.result?.command === 'git push-branch'))
  const mergedBack = homeStep(run.steps.find((s) => homeSteps.has(s.name) && s.result))
  const kept = run.env?.kept
  const stuck = run.env ? strandedLine(run.env) : null
  const home: RunHome = {
    ...(pushed ? { pushed } : {}),
    ...(mergedBack ? { mergedBack } : {}),
    ...(kept ? { kept } : {}),
    ...(stuck ? { stuck } : {})
  }
  return Object.keys(home).length > 0 ? home : null
}
