import type { HoldReason } from '../../../shared/api-types'
import type { CapacityPayload, QuotaUse } from '../../../shared/api-types-capacity'
import type { AgentKind } from '../../../shared/definition/types'

// What the runner checks before a run starts (shared/tick/runner-gates.ts and main/capacity), in its order, with the
// hold codes each one stores on a Waiting row.
export type RunnerCheck = {
  name: string
  holds: string
  again: string
  codes: readonly HoldReason[]
  // A retry waits for its time; every other check holds the row.
  waits?: boolean
}

export const RUNNER_CHECKS: readonly RunnerCheck[] = [
  {
    name: 'Retry wait',
    holds:
      "a failed run waits 10 min (or the job's retry_after_failure); past the retry limit it gives up and leaves a card, except a give_up: never job, which waits twice as long each time, up to an hour",
    again: 'at its time',
    codes: ['retry'],
    waits: true
  },
  {
    name: "The job's own gates",
    holds:
      "a session still open, answers waiting to apply, outside its time window, or a kept fix that can't merge into its worktree yet",
    again: 'every 5 min',
    codes: ['session_open', 'answers_pending', 'window', 'merge_blocked']
  },
  {
    name: 'Agent quota',
    holds: "an agent the job's steps use is over the quota ceiling, or the job's own quota line",
    again: 'every 5 min',
    codes: ['quota']
  },
  {
    name: 'Busy worktree',
    holds: "another Pilot run works in the item's own worktree",
    again: 'every 60 s',
    codes: ['worktree_busy']
  },
  {
    name: 'Its own run',
    holds: "the job's earlier run on the same item is still going",
    again: 'every 60 s',
    codes: ['own_run']
  },
  {
    name: 'Job limits',
    holds: "past per_tick (waits for the job's next tick) or at_once (frees as its runs end)",
    again: 'next tick · 60 s',
    codes: ['job_limit', 'tick_limit']
  },
  {
    name: 'Jobs at once',
    holds: 'every slot is in use; the line goes oldest due first',
    again: 'as slots free',
    codes: ['capacity']
  }
]

// The job's own eligibility: an item that isn't due is skipped until the next tick, never held.
export const JOB_DECIDES: readonly string[] = [
  'In scope',
  'Once per key',
  'First sight',
  'MR not merged, not approved',
  'Worktree exists',
  'Field and script checks'
]

// Where a run works: chosen once at its start, never a reason to wait.
export const PLACE_RULES: readonly { title: string; body: string }[] = [
  { title: 'Nothing in flight', body: 'It works in your worktree.' },
  {
    title: 'Work in flight, or a backend change',
    body: 'A throwaway at your HEAD, with its own backend stack when the branch changes api/. Only your commits go in.'
  },
  {
    title: 'Bringing it home',
    body: "Merged into your worktree once you're free; pushed if the job pushes. What can't come home yet, uncommitted edits included, is kept on pilot/<run>, and job 15 merges it in, trying until it lands."
  }
]

// The check a Waiting row's hold comes from; null for a code only the Inbox's queue uses, or one from a newer Pilot.
export function checkOf(code: HoldReason | undefined): RunnerCheck | null {
  if (code === undefined) {
    return null
  }
  return RUNNER_CHECKS.find((check) => check.codes.includes(code)) ?? null
}

const AGENT_NAMES: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' }
const AGENTS: readonly AgentKind[] = ['claude', 'codex']

function over(use: QuotaUse, ceiling: { weekly: number; session: number }): string | null {
  if (use.weekly !== null && use.weekly >= ceiling.weekly) {
    return `${Math.round(use.weekly)}% weekly`
  }
  if (use.session !== null && use.session >= ceiling.session) {
    return `${Math.round(use.session)}% session`
  }
  return null
}

// Each agent's use now: the ones past the ceiling, and every weekly figure; null when the payload carries none.
function quotaUse(p: CapacityPayload): { blocked: string[]; weekly: string[] } | null {
  const ceiling = p.quotaCeiling
  const use = p.quotaUse
  if (!ceiling || !use) {
    return null
  }
  const known = AGENTS.flatMap((agent) => {
    const u = use[agent]
    return u ? [{ agent, use: u }] : []
  })
  return {
    blocked: known.flatMap((k) => {
      const past = over(k.use, ceiling)
      return past ? [`${AGENT_NAMES[k.agent]} ${past}`] : []
    }),
    weekly: known.flatMap((k) =>
      k.use.weekly === null ? [] : [`${AGENT_NAMES[k.agent]} ${Math.round(k.use.weekly)}%`]
    )
  }
}

// The quota field's line: who is past the ceiling, else each agent's weekly use; null without live use.
export function quotaUseText(p: CapacityPayload): string | null {
  const use = quotaUse(p)
  if (!use) {
    return null
  }
  if (use.blocked.length > 0) {
    return `${use.blocked.join(', ')} now: agent steps wait`
  }
  return use.weekly.length > 0 ? `${use.weekly.join(' · ')} weekly now` : null
}

function slotsNow(p: CapacityPayload): { text: string; holding: boolean } {
  const used = p.running.filter((r) => r.counted).length
  const waiting = p.queued.filter(
    (q) => q.holdCode === undefined || q.holdCode === 'capacity'
  ).length
  const inUse = p.limit === null ? `${used} running, no limit` : `${used} of ${p.limit} used`
  return { text: waiting > 0 ? `${inUse} · ${waiting} in line` : inUse, holding: waiting > 0 }
}

// What a check is doing now, from the payload's rows; holding is true while it holds any.
export function checkNow(
  check: RunnerCheck,
  p: CapacityPayload
): { text: string; holding: boolean } {
  if (check.codes.includes('capacity')) {
    return slotsNow(p)
  }
  const count = p.queued.filter(
    (q) => q.holdCode !== undefined && check.codes.includes(q.holdCode)
  ).length
  if (count === 0) {
    return { text: check.waits ? 'none waiting' : 'none held', holding: false }
  }
  const counted = `${check.waits ? 'waiting' : 'holding'} ${count}`
  const blocked = check.codes.includes('quota') ? (quotaUse(p)?.blocked ?? []) : []
  return { text: blocked.length > 0 ? `${counted}: ${blocked.join(', ')}` : counted, holding: true }
}
