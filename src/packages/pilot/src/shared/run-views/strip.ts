import type { ActivityRun } from '../api-types-runs'
import type { ChainPart, Who } from './chain'
import { isPainted, paintRun, type PartState } from './paint'

// One chip of a strip. `state` is null on a chain with no run; `runIds` are the live runs a list chip is lit for.
export type StripChip = {
  key: string
  label: string
  who: Who
  state: PartState | null
  runIds: string[]
  // The part openRun scrolls to when the chip is clicked.
  part: string
}
export type StripItem =
  | { kind: 'chip'; chip: StripChip }
  | { kind: 'more'; key: string; count: number; unit: string | null }

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

function mergedState(parts: readonly ChainPart[]): PartState | null {
  const states = parts.filter(isPainted).map((p) => p.state)
  if (states.length === 0) {
    return null
  }
  return PRESSING.find((s) => states.includes(s)) ?? null
}

function chip(key: string, label: string, who: Who, parts: readonly ChainPart[]): StripChip {
  return { key, label, who, state: mergedState(parts), runIds: [], part: parts[0]?.key ?? 'starts' }
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

// The strip's chips for a chain or a painted run (spec §2): the Pilot parts before any step as one grey chip, the field
// scripts as one, the ask, then one chip per step.
export function stripOf(parts: readonly ChainPart[]): StripChip[] {
  const pre = parts.filter((p) => p.group === 'before' && p.kind !== 'field' && p.kind !== 'ask')
  const fields = parts.filter((p) => p.kind === 'field')
  const chips = [chip('pre', preLabel(parts), 'pilot', pre)]
  if (fields.length > 0) {
    chips.push(chip('fields', plural(fields.length, 'field script'), 'script', fields))
  }
  for (const p of parts.filter(ownChip)) {
    chips.push(chip(p.key, p.short, p.who, [p]))
  }
  return chips
}

// The list's strip (no run of its own): the chain, each chip lit where live runs are, with their ids, so a chip opens its
// one run, or Activity when there are several. A lit chip the chain has no place for (an answer run's) is added.
export function liveStrip(chain: readonly ChainPart[], live: readonly ActivityRun[]): StripChip[] {
  const chips = stripOf(chain)
  for (const run of live) {
    for (const lit of stripOf(paintRun(chain, { run }).parts)) {
      if (!lit.state || !LIT.includes(lit.state)) {
        continue
      }
      const target = chips.find((c) => c.key === lit.key)
      if (!target) {
        chips.push({ ...lit, runIds: [run.id] })
        continue
      }
      target.runIds.push(run.id)
      target.state = target.state === 'running' ? 'running' : lit.state
    }
  }
  return chips
}

function keptIndexes(chips: readonly StripChip[], max: number): Set<number> {
  const lit = chips.flatMap((c, i) => (c.state && FOCUS.includes(c.state) ? [i] : []))
  if (lit.length === 0) {
    return new Set(Array.from({ length: max - 1 }, (_, i) => i))
  }
  const kept = [0, ...lit.flatMap((i) => [i - 1, i, i + 1])]
  return new Set(kept.filter((i) => i >= 0 && i < chips.length))
}

function more(at: number, count: number): StripItem {
  return { kind: 'more', key: `more:${at}`, count, unit: null }
}

// A long strip keeps its first chip and every chip that matters now (running, asking, failed) with the first one's
// neighbours, and folds the rest into "+N" (spec §2).
export function foldStrip(chips: readonly StripChip[], max = STRIP_MAX): StripItem[] {
  if (chips.length <= max) {
    return chips.map((c) => ({ kind: 'chip', chip: c }))
  }
  const keep = keptIndexes(chips, max)
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
