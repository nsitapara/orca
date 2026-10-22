import type { RunRow, RunStatus } from '../api-types'
import type { MergeBack } from '../api-types-runs'
import { strandedLine } from '../env-text'
import type { PartState } from './paint'

// Where a throwaway run's kept fix is on its way into its worktree: the run strip's Merge back part and the Running
// page's Merge back list both say it this way.
export type MergeBackState = { state: PartState; detail: string | null; linkRunId: string | null }

const LIVE: readonly RunStatus[] = ['running', 'asking']

function state(
  s: PartState,
  detail: string | null,
  linkRunId: string | null = null
): MergeBackState {
  return { state: s, detail, linkRunId }
}

// From the run's env (what env delete kept, and whether the branch is gone from git) and the kept_branch job's runs for
// that branch, newest first, with why its item waits in line.
export function mergeBackState(
  run: RunRow,
  mergeBack: MergeBack | null | undefined
): MergeBackState {
  const env = run.env
  if (env?.mode !== 'throwaway') {
    return state('none', null)
  }
  if (LIVE.includes(run.status)) {
    return state('not_reached', null)
  }
  if (env.removedAt === null) {
    // A throwaway Pilot can't remove that holds work nothing else has never reads as on its way.
    const stuck = strandedLine(env)
    if (stuck) {
      return state('failed', stuck)
    }
    const tries = env.deleteAttempts === 1 ? 'try' : 'tries'
    const why = env.deleteError
      ? ` (${env.deleteAttempts} ${tries} so far: ${env.deleteError})`
      : ''
    return state('running', `Removing the throwaway${why}`)
  }
  const kept = env.kept
  if (!kept) {
    return state('skipped', 'Nothing to merge back: its commits reached your worktree or origin')
  }
  const last = mergeBack?.runs[0] ?? null
  const link = last?.id ?? null
  if (env.keptGoneAt || last?.status === 'done') {
    const merged = last?.status === 'done' || !env.keptGoneAt
    return state('done', merged ? `Merged ${kept} into your worktree` : `${kept} is gone`, link)
  }
  if (last && LIVE.includes(last.status)) {
    return state('running', `Merging ${kept}`, link)
  }
  if (last?.status === 'needs_you') {
    return state('asking', `Merging ${kept} needs you`, link)
  }
  if (mergeBack?.waiting) {
    return state('not_reached', `Waiting in line: ${mergeBack.waiting}`, link)
  }
  if (last) {
    return state('failed', last.outcome ?? `Merging ${kept} failed`, link)
  }
  return state('not_reached', `Kept on ${kept}; queued for merge back`)
}
