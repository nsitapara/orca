const MIB = 1024 ** 2
const GIB = 1024 ** 3

// As web-platform's e2e-parallel.sh: 4 GB stays free for everything else, and a job nobody has measured yet is
// budgeted like one of its stacks.
export const HEADROOM_BYTES = 4 * GIB
export const UNMEASURED_JOB_BYTES = 2.5 * GIB
// A job measured almost empty still gets a floor, so the division never suggests dozens.
const MIN_JOB_BYTES = 256 * MIB
// The picker's top; more agents than this mostly contend for CPU.
export const MAX_RUN_LIMIT = 10

export type LimitSuggestionInput = {
  availableBytes: number
  // What the running jobs hold now comes back when they end, so it counts toward the jobs' budget.
  runningJobsBytes: number
  // The heaviest job's measured peak; null until a job has been measured.
  worstJobBytes: number | null
}

export type LimitSuggestion = {
  limit: number
  budgetBytes: number
  perJobBytes: number
  measured: boolean
}

export function suggestRunLimit(input: LimitSuggestionInput): LimitSuggestion {
  const perJobBytes = Math.max(input.worstJobBytes ?? UNMEASURED_JOB_BYTES, MIN_JOB_BYTES)
  const budgetBytes = Math.max(0, input.availableBytes + input.runningJobsBytes - HEADROOM_BYTES)
  const fits = Math.floor(budgetBytes / perJobBytes)
  return {
    limit: Math.min(Math.max(fits, 1), MAX_RUN_LIMIT),
    budgetBytes,
    perJobBytes,
    measured: input.worstJobBytes !== null
  }
}
