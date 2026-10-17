import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const PARITY_DIR = import.meta.dirname
export type OldDecision = { key: string; label: string; decision: string; reason: string }

export function skillsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.PARITY_SKILLS_DIR ?? join(homedir(), '.agents', 'skills')
}

// The old side of every job, whose code is gone, frozen into each case file's `old` block while it still ran (13 and 09, on
// 2026-10-16, before milestone 7 deleted dev-e2e-fix's sweep.py and pilot_mode.py and review-requests' sweep.py; M01 and
// 03, the same day, before milestone 8 deleted linear-todo-sweep's sweep.py and review-cycles' loop.py; 02, 05 and 06,
// the same day, before ~/.agents' Python went: worktree-gate's quota.py, ci-fix-sweep and mr-feedback-sweep):
// the old plan's decisions, and what the job's own scripts printed for the case.
export type FrozenOldSide = {
  // How it was recorded.
  from: string
  decisions: OldDecision[]
  // M01: the old sweep stopped on the case instead of deciding (its error's last line); decisions is then empty.
  stopped?: string
  // 13: pilot_mode.py list-fix-tickets on the case's tickets.json, which where.ids_from now asks pilotcli for.
  ids?: { code: number; stdout: string }
  // 09: `sweep.py field <name>`'s stdout per item key, for each item Pilot asked (head8, context).
  fields?: Record<string, Record<string, string>>
}

// A case's frozen old side. One without it fails, never skips: there is no old code left to run in its place.
export function frozenOldSide(kase: {
  job: string
  case: string
  old?: FrozenOldSide
}): FrozenOldSide {
  if (!kase.old || !Array.isArray(kase.old.decisions)) {
    throw new Error(
      `${kase.job}/${kase.case} has no frozen old side (its "old" block): its old code is gone, so the case can't be compared`
    )
  }
  return kase.old
}

// The old plan's decisions on a case, as frozen in its file.
export function frozenOldPlan(fixturePath: string): OldDecision[] {
  return frozenOldSide(JSON.parse(readFileSync(fixturePath, 'utf8'))).decisions
}
