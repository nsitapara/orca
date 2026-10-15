import type { RunRow } from '../../shared/api-types'
import { envCleanupLine, envStackLine, envWhereLine } from '../../shared/env-text'

type EnvRun = Pick<RunRow, 'status' | 'env'>

function ended(run: EnvRun): boolean {
  return run.status !== 'running' && run.status !== 'asking'
}

// Where an env run worked, its stack, and a delete that hasn't succeeded (the run panel's lines).
export function envLines(run: EnvRun): string[] {
  const env = run.env
  if (!env) {
    return []
  }
  const lines = [envWhereLine(env), envStackLine(env), envCleanupLine(env, ended(run))]
  return lines.filter((line): line is string => line !== null)
}

// Just a delete that hasn't finished, for the rows that list runs.
export function envCleanup(run: EnvRun): string | null {
  if (!run.env) {
    return null
  }
  return envCleanupLine(run.env, ended(run))
}
