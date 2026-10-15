import type { ActionRunRow } from '../../shared/api-types-actions'
import type { Effect, EffectKind } from '../../shared/visibility-types'
import type { GitOperation, ParsedEntry } from './claude-log'
import { commandEffects, type CommandEffect } from './effects-commands'

const MR_URL = /\/-\/merge_requests\/(\d+)/
const PR_KIND: Record<string, EffectKind | undefined> = {
  created: 'mr_opened',
  edited: 'mr_updated',
  ready: 'mr_ready'
}

function gitEffects(git: GitOperation | null): CommandEffect[] {
  const out: CommandEffect[] = []
  if (git?.push) {
    out.push({ kind: 'pushed', target: git.push.branch ?? null })
  }
  const kind = PR_KIND[git?.pr?.action ?? '']
  if (kind && git?.pr?.number !== undefined) {
    out.push({ kind, target: `!${git.pr.number}` })
  }
  return out
}

// One entry's effects, one per kind: gitOperation and the command often say the same push, the one naming its target
// wins.
function perEntry(list: readonly CommandEffect[]): CommandEffect[] {
  const byKind = new Map<EffectKind, CommandEffect>()
  for (const c of list) {
    const had = byKind.get(c.kind)
    if (!had || (!had.target && c.target)) {
      byKind.set(c.kind, c)
    }
  }
  return [...byKind.values()]
}

function guessTarget(kind: EffectKind, e: Extract<ParsedEntry, { kind: 'tool' }>): string | null {
  if (kind === 'mr_opened') {
    const n = e.links.map((l) => MR_URL.exec(l)?.[1]).find((m) => m !== undefined)
    return n === undefined ? null : `!${n}`
  }
  return kind === 'ticket_created' ? (e.ids[0] ?? null) : null
}

function urlFrom(target: string | null, links: readonly string[]): string | null {
  if (!target) {
    return null
  }
  if (target.startsWith('!')) {
    return links.find((l) => MR_URL.exec(l)?.[1] === target.slice(1)) ?? null
  }
  return links.find((l) => l.includes(`/issue/${target}`)) ?? null
}

// The same effect done again in a step counts up instead of repeating; the first one's time and link are kept.
export function mergeEffects(list: readonly Effect[]): Effect[] {
  const merged = new Map<string, Effect>()
  for (const e of list) {
    const key = [e.kind, e.target ?? '', e.stepIdx ?? ''].join('\u0000')
    const had = merged.get(key)
    merged.set(key, had ? { ...had, count: had.count + e.count, url: had.url ?? e.url } : { ...e })
  }
  return [...merged.values()]
}

// What one agent step changed outside Pilot, from its log entries inside the step's window (spec §2).
export function stepEffects(entries: readonly ParsedEntry[], stepIdx: number): Effect[] {
  const found: Effect[] = []
  for (const e of entries) {
    if (e.kind !== 'tool' || e.status !== 'ok') {
      continue
    }
    const own = [...gitEffects(e.git), ...(e.command ? commandEffects(e.command) : [])]
    for (const c of perEntry(own)) {
      const target = c.target ?? guessTarget(c.kind, e)
      found.push({
        kind: c.kind,
        target,
        url: urlFrom(target, e.links),
        count: 1,
        stepIdx,
        at: e.at
      })
    }
  }
  return mergeEffects(found)
}

function resultOf(output: string | null): { detail?: unknown; link?: unknown } {
  try {
    const value: unknown = JSON.parse(output ?? 'null')
    return value && typeof value === 'object' ? (value as { detail?: unknown; link?: unknown }) : {}
  } catch {
    return {}
  }
}

// The run's own catalog actions that did their work (phase do, status done), as act.py described them.
export function actionEffects(rows: readonly ActionRunRow[]): Effect[] {
  return rows
    .filter((r) => r.phase === 'do' && r.status === 'done' && !r.dryRun)
    .map((r) => {
      const result = resultOf(r.output)
      return {
        kind: 'action' as const,
        target: typeof result.detail === 'string' && result.detail ? result.detail : r.action,
        url: typeof result.link === 'string' ? result.link : null,
        count: 1,
        stepIdx: null,
        at: r.finishedAt ?? r.startedAt
      }
    })
}
