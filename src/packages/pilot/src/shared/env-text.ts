import type { RunRow, RunStatus, TickOutcome } from './api-types'
import type { RunEnv, StrandedWork } from './api-types-env'
import { hadNothingToDo, NOTHING_TO_DO } from './run/step-plan'

function withReason(words: string, reason: string | null): string {
  return reason ? `${words}: ${reason}` : words
}

// Where the run worked (M4 §8 modes), for the run card, Activity, the job page and the CLI.
export function envWhereLine(env: RunEnv): string {
  if (env.state === 'preparing') {
    return 'Preparing its workspace'
  }
  if (env.state === 'deferred') {
    return withReason('Deferred', env.reason)
  }
  if (env.mode === 'in_place') {
    return 'Worked in place'
  }
  if (env.mode === 'throwaway') {
    return withReason('Worked in a throwaway', env.reason)
  }
  if (env.mode === 'kept') {
    return withReason('Worked in a new worktree, kept', env.path)
  }
  return withReason("Its workspace wasn't made", env.reason)
}

export function envStackLine(env: RunEnv): string | null {
  const stack = env.stack
  if (!stack) {
    return null
  }
  const urls = Object.entries(stack.urls).map(([name, url]) => `${name} ${url}`)
  return [`${stack.kind} stack ${stack.project}`, ...urls].join(' · ')
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

// What a stuck throwaway holds, in a few words: "commit a46c16a5a5", "2 commits and 3 uncommitted files".
export function strandedWhat(work: StrandedWork): string {
  const parts: string[] = []
  if (work.commits.length === 1) {
    parts.push(`commit ${work.commits[0].slice(0, 10)}`)
  } else if (work.commits.length > 1) {
    parts.push(count(work.commits.length, 'commit'))
  }
  if (work.edits > 0) {
    parts.push(count(work.edits, 'uncommitted file'))
  }
  return parts.join(' and ')
}

// A throwaway Pilot couldn't remove that holds work nothing else has: nothing kept it on a branch, so job 15 can't
// merge it home. Null for any other env. The Merge back step, the Merge back list and Finished all say it this way.
export function strandedLine(env: RunEnv): string | null {
  if (env.removedAt !== null || !env.stranded) {
    return null
  }
  const tries = count(env.deleteAttempts, 'try', 'tries')
  const why = env.deleteError ? `: ${env.deleteError}` : ''
  return `Stuck: ${strandedWhat(env.stranded)} only in its throwaway, which Pilot can't remove (${tries})${why}`
}

// What is left to say about removing the env: nothing once removed, or while the run still goes.
export function envCleanupLine(env: RunEnv, ended: boolean): string | null {
  if (env.removedAt !== null || !ended) {
    return null
  }
  if (env.state === 'stuck') {
    return `pilotcli refused to remove it (${env.deleteError ?? 'invalid'}); remove it by hand`
  }
  // A not_yet delete (its create still runs) records why without counting a try.
  if (env.deleteError && env.deleteAttempts === 0) {
    return `Waiting to remove it: ${env.deleteError}`
  }
  if (env.deleteError) {
    const tries = env.deleteAttempts === 1 ? 'try' : 'tries'
    return `Couldn't remove it yet (${env.deleteAttempts} ${tries}): ${env.deleteError}`
  }
  return 'Being removed'
}

// Reads the kept env outcome (Ruling P4): a deferred env stays "deferred" after its removal.
export function runStatusWord(
  run: Pick<RunRow, 'status' | 'env' | 'outcome'>,
  label: (status: RunStatus) => string
): string {
  if (hadNothingToDo(run)) {
    return NOTHING_TO_DO
  }
  if (run.status === 'running' && run.env?.state === 'preparing') {
    return 'Preparing workspace'
  }
  if (run.status === 'cancelled' && run.env?.state === 'deferred') {
    return 'Deferred'
  }
  return label(run.status)
}

export function workspacePreviewLines(result: TickOutcome): string[] {
  if (!('decisions' in result)) {
    return []
  }
  return result.decisions.flatMap((d) => (d.workspace ? [`${d.label}: ${d.workspace}`] : []))
}
