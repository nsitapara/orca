import { constants, setPriority } from 'node:os'

export function positiveInteger(env, name, fallback) {
  const raw = env[name]
  if (raw === undefined || raw === '') {
    return fallback
  }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, not ${raw}`)
  }
  return value
}

// Pilot checks only on the dev machine, beside the desktop and other worktrees' agents: a typecheck
// holds one compiler on a few cores, tests a few workers, check:changed a couple of checks at once.
// Raise any of them for a faster, heavier run.
export function localTypecheckLimits(env = process.env) {
  return {
    jobs: positiveInteger(env, 'ORCA_TYPECHECK_JOBS', 1),
    threads: positiveInteger(env, 'ORCA_TYPECHECK_THREADS', 4)
  }
}

export function localTestWorkers(env = process.env) {
  return positiveInteger(env, 'ORCA_TEST_WORKERS', 2)
}

export function localCheckJobs(env = process.env) {
  return positiveInteger(env, 'ORCA_CHECK_JOBS', 2)
}

// Children inherit the lowered priority, so the desktop stays responsive while they run.
export function lowerProcessPriority(label) {
  try {
    setPriority(constants.priority.PRIORITY_BELOW_NORMAL)
  } catch (error) {
    console.error(`${label}: couldn't lower priority: ${error.message}`)
  }
}
