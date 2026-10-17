import type { ActivityRun } from '../api-types-runs'
import type { ChainPart, Who } from './chain'
import { isPainted, paintRun, type PaintedPart, type PartState } from './paint'
import { NOT_REACHED, NOT_REACHED_YET, runTimeline, type RunTimeline } from './timeline'

// One chip of a strip. `state` is null on a chain with no run; `runIds` are the live runs a list chip is lit for, as
// liveStrip's keyOf names them.
export type StripChip = {
  key: string
  label: string
  who: Who
  state: PartState | null
  runIds: string[]
  // The part openRun scrolls to when the chip is clicked.
  part: string
  // A step's number: its place in the plan, or in the order a run's steps ran. Null for the parts around the steps.
  n: number | null
}
export type StripItem =
  | { kind: 'chip'; chip: StripChip }
  | { kind: 'more'; key: string; count: number; unit: string | null }
  | { kind: 'note'; key: string; text: string }

export const STRIP_MAX = 6
// What a chip of several parts shows: a failure first, then a wait on Nish, then work under way.
const PRESSING: readonly PartState[] = [
  'failed',
  'asking',
  'running',
  'done',
  'skipped',
  'not_reached',
  'none'
]
const LIT: readonly PartState[] = ['running', 'asking']
// The chips a folded strip keeps in view, each with its neighbours.
const FOCUS: readonly PartState[] = ['running', 'asking', 'failed']

function plural(n: number, word: string): string {
  return n === 1 ? `1 ${word}` : `${n} ${word}s`
}

// A step whose open card its finished run waits on is lit as asking on the plan's strip; the step itself keeps its state.
function stripState(p: PaintedPart): PartState {
  return p.card && p.state !== 'running' ? 'asking' : p.state
}

function mergedState(parts: readonly ChainPart[]): PartState | null {
  const states = parts.filter(isPainted).map(stripState)
  if (states.length === 0) {
    return null
  }
  return PRESSING.find((s) => states.includes(s)) ?? null
}

// The part the chip opens the panel at: the one with the most pressing state, else the first.
function pressingPart(parts: readonly ChainPart[]): string {
  const state = mergedState(parts)
  const worst = parts.find((p) => isPainted(p) && stripState(p) === state)
  return (worst ?? parts[0])?.key ?? 'starts'
}

function chip(
  key: string,
  label: string,
  who: Who,
  parts: readonly ChainPart[],
  n: number | null = null
): StripChip {
  return { key, label, who, state: mergedState(parts), runIds: [], part: pressingPart(parts), n }
}

// "MRs · 2 gates": what it looks at and how many checks it makes.
function preLabel(parts: readonly ChainPart[]): string {
  const looksAt = parts.find((p) => p.kind === 'picks')?.short ?? 'Runs'
  const gates = parts
    .filter((p) => p.kind === 'gates' || p.kind === 'check')
    .reduce((n, p) => n + p.checks.length, 0)
  return gates === 0 ? looksAt : `${looksAt} · ${plural(gates, 'gate')}`
}

// A chip of its own: the ask, each of the chain's steps, and Answers while a run is answering (a chain's strip has no
// Answers chip). An answer run's own steps (group asks) show through the Answers chip, never as steps.
function ownChip(p: ChainPart): boolean {
  if (p.kind === 'ask' || (p.kind === 'step' && p.group === 'steps')) {
    return true
  }
  return p.kind === 'answers' && isPainted(p) && p.state !== 'none'
}

// The plan's strip (spec §2): the Pilot parts before any step as one grey chip, the field scripts as one, the ask, then
// each step by its number and name.
export function stripOf(parts: readonly ChainPart[]): StripChip[] {
  const pre = parts.filter((p) => p.group === 'before' && p.kind !== 'field' && p.kind !== 'ask')
  const fields = parts.filter((p) => p.kind === 'field')
  const chips = [chip('pre', preLabel(parts), 'pilot', pre)]
  if (fields.length > 0) {
    chips.push(chip('fields', plural(fields.length, 'field script'), 'script', fields))
  }
  let n = 0
  for (const p of parts.filter(ownChip)) {
    if (p.kind === 'step') {
      n += 1
      chips.push(chip(p.key, p.name, p.who, [p], n))
    } else {
      chips.push(chip(p.key, p.short, p.who, [p]))
    }
  }
  return chips
}

// What a run's line says after its steps: how many didn't run, weren't reached, or are still to go.
function notRunText(timeline: RunTimeline): string | null {
  const count = (pick: (reason: string) => boolean): number =>
    timeline.notRun.filter((g) => pick(g.reason)).reduce((n, g) => n + g.parts.length, 0)
  const said = [
    [count((r) => r !== NOT_REACHED && r !== NOT_REACHED_YET), "didn't run"],
    [count((r) => r === NOT_REACHED), 'not reached'],
    [count((r) => r === NOT_REACHED_YET), 'to go']
  ] as const
  const parts = said.filter(([n]) => n > 0).map(([n, words]) => `${n} ${words}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

// A run's line (the card's From run, Activity, the worktree panel): the steps that ran, numbered in the order they ran,
// and a parts-before or answers chip only while it is where the run stands (failed, running, asking). `keep` names a
// chip folding must keep (the step a card came from).
export function runStrip(
  parts: readonly PaintedPart[],
  run: Pick<ActivityRun, 'status' | 'trigger'>,
  keep: string | null = null,
  max = STRIP_MAX
): StripItem[] {
  const timeline = runTimeline(parts, run)
  // An answer run is the answers: its Answers chip would only repeat the run's own state.
  const around = stripOf(parts).filter(
    (c) =>
      c.n === null &&
      c.state !== null &&
      c.state !== 'none' &&
      c.state !== 'done' &&
      !(c.key === 'answers' && run.trigger === 'answer')
  )
  const ran = timeline.ran.map(({ n, part }) => ({
    key: part.key,
    label: part.name,
    who: part.who,
    state: part.state,
    runIds: [],
    part: part.key,
    n
  }))
  const before = around.filter((c) => c.key !== 'answers')
  const after = around.filter((c) => c.key === 'answers')
  const items = foldStrip([...before, ...ran, ...after], max, keep)
  const note = notRunText(timeline)
  return note ? [...items, { kind: 'note', key: 'not-run', text: note }] : items
}

// The list's strip (no run of its own): the chain, each chip lit where live runs are, with their ids (`keyOf`), so a chip
// opens its one run, or Activity when there are several. A lit chip the chain has no place for (an answer run's) is added.
export function liveStrip<R extends ActivityRun>(
  chain: readonly ChainPart[],
  live: readonly R[],
  keyOf: (run: R) => string = (run) => run.id
): StripChip[] {
  const chips = stripOf(chain)
  for (const run of live) {
    const painted = paintRun(chain, { run })
    for (const lit of stripOf(painted.parts)) {
      if (!lit.state || !LIT.includes(lit.state)) {
        continue
      }
      // A run older than a YAML change, or imported from the vault: its step N isn't the chain's step N, so no step
      // chip is lit for it.
      if ((painted.drifted || run.trigger === 'import') && lit.key.startsWith('step:')) {
        continue
      }
      const target = chips.find((c) => c.key === lit.key)
      if (!target) {
        chips.push({ ...lit, runIds: [keyOf(run)] })
        continue
      }
      target.runIds.push(keyOf(run))
      target.state = target.state === 'running' ? 'running' : lit.state
    }
  }
  return chips
}

function keptIndexes(chips: readonly StripChip[], max: number, keep: string | null): Set<number> {
  const lit = chips.flatMap((c, i) =>
    (c.state && FOCUS.includes(c.state)) || c.key === keep ? [i] : []
  )
  if (lit.length === 0) {
    return new Set(Array.from({ length: max - 1 }, (_, i) => i))
  }
  const kept = [0, ...lit.flatMap((i) => [i - 1, i, i + 1])]
  return new Set(kept.filter((i) => i >= 0 && i < chips.length))
}

function more(at: number, count: number): StripItem {
  return { kind: 'more', key: `more:${at}`, count, unit: null }
}

// A long strip keeps its first chip and every chip that matters now (running, asking, failed, or the one named by
// `keep`) with its neighbours, and folds the rest into "+N" (spec §2).
export function foldStrip(
  chips: readonly StripChip[],
  max = STRIP_MAX,
  keepKey: string | null = null
): StripItem[] {
  if (chips.length <= max) {
    return chips.map((c) => ({ kind: 'chip', chip: c }))
  }
  const keep = keptIndexes(chips, max, keepKey)
  const items: StripItem[] = []
  let hidden = 0
  chips.forEach((c, i) => {
    if (!keep.has(i)) {
      hidden += 1
      return
    }
    if (hidden > 0) {
      items.push(more(i, hidden))
      hidden = 0
    }
    items.push({ kind: 'chip', chip: c })
  })
  if (hidden > 0) {
    items.push(more(chips.length, hidden))
  }
  return items
}
