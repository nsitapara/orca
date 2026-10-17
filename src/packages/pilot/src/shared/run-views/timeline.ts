import type { RunStatus } from '../api-types'
import type { ActivityRun } from '../api-types-runs'
import { hadNothingToDo, NOTHING_TO_DO } from '../run/step-plan'
import type { PaintedPart } from './paint'

// A step that ran, numbered from 1 in the order the steps started.
export type RanStep = { n: number; part: PaintedPart }
// Steps that didn't run, under the reason they share.
export type NotRunGroup = { reason: string; parts: PaintedPart[] }
export type RunTimeline = { ran: RanStep[]; notRun: NotRunGroup[] }

export const CONDITION_NOT_MET = "Their condition wasn't met"
export const NOT_REACHED_YET = 'Not reached yet'
export const NOT_REACHED = 'Not reached'
const LIVE: readonly RunStatus[] = ['running', 'asking']

// A step ran once it started. A step skipped by its exit code (exit_codes.skip) ran too; one skipped by its `when`, or
// because an earlier step failed, never started.
function didRun(p: PaintedPart): boolean {
  const step = p.step
  if (!step || step.status === 'pending') {
    return false
  }
  return step.status !== 'skipped' || step.exitCode !== null
}

function notRunReason(p: PaintedPart, live: boolean): string {
  const step = p.step
  if (!step || step.status === 'pending') {
    return live ? NOT_REACHED_YET : NOT_REACHED
  }
  const why = step.error ?? ''
  if (why.startsWith('when:')) {
    return CONDITION_NOT_MET
  }
  return why || 'Skipped'
}

function startedAt(p: PaintedPart): number {
  return p.step?.startedAt ?? Number.MAX_SAFE_INTEGER
}

// One run's steps as a timeline (the run panel, the "what ran" line): those that ran in the order they started, then
// those that didn't, grouped by why. Nothing before any step and nothing after the steps is in it.
export function runTimeline(
  parts: readonly PaintedPart[],
  run: Pick<ActivityRun, 'status'>
): RunTimeline {
  const steps = parts.filter((p) => p.kind === 'step')
  const ran = steps
    .filter(didRun)
    .sort((a, b) => startedAt(a) - startedAt(b) || (a.stepIdx ?? 0) - (b.stepIdx ?? 0))
    .map((part, i) => ({ n: i + 1, part }))
  const live = LIVE.includes(run.status)
  const groups = new Map<string, PaintedPart[]>()
  for (const p of steps.filter((s) => !didRun(s))) {
    const reason = notRunReason(p, live)
    groups.set(reason, [...(groups.get(reason) ?? []), p])
  }
  return { ran, notRun: [...groups].map(([reason, grouped]) => ({ reason, parts: grouped })) }
}

// The run's state with the step it is at: "Running step 2", "Failed at step 4"; otherwise the run's own label.
export function runHeadline(
  run: Pick<ActivityRun, 'status' | 'outcome'>,
  timeline: RunTimeline,
  label: (status: RunStatus) => string
): string {
  if (hadNothingToDo(run)) {
    return NOTHING_TO_DO
  }
  if (run.status === 'running') {
    const at = timeline.ran.find((s) => s.part.state === 'running')
    return at ? `Running step ${at.n}` : label(run.status)
  }
  if (run.status === 'failed' || run.status === 'timed_out') {
    const at = timeline.ran.find((s) => s.part.state === 'failed')
    return at ? `${label(run.status)} at step ${at.n}` : label(run.status)
  }
  return label(run.status)
}
