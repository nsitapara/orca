import { evidenceGate } from '../../shared/evidence'
import { createHash } from 'node:crypto'
import type { InboxItemRow } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import { WAITING } from '../inbox/inbox-service'
import type { PilotStore } from '../store/store'
import type { ActionCatalog, ActionEntry } from './types'

// Who may do or propose what (spec §6 "Powers"). Fail closed: anything not shown allowed is refused.

export type PowersDeps = { store: PilotStore; definitions(): AutomationDefinition[] }

export const unknownAction = (name: string): string =>
  `No action named "${name}" in Pilot's catalog`

export function argsDigest(action: string, args: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify([action, args]))
    .digest('hex')
}

// Key order never changes what an attempt is.
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).toSorted(([a], [b]) =>
      a < b ? -1 : 1
    )
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function definitionOf(
  deps: Pick<PowersDeps, 'definitions'>,
  id: string
): AutomationDefinition | null {
  return deps.definitions().find((d) => d.id === id) ?? null
}

export function hasPower(entry: ActionEntry, def: AutomationDefinition): boolean {
  return entry.power !== null && def.powers.includes(entry.power)
}

export function missingWhat(entry: ActionEntry): string {
  return entry.power === null ? "a person's approval" : `the ${entry.power} power`
}

// Why `def` may not file a card proposing `action` with `args`, or null when it may: the action is in the
// catalog, the args fit it, and the automation has its power (what it could do itself, it may ask a
// person to approve). An approval-only action (no power) is only ever asked for by Pilot itself.
export function proposalProblem(
  catalog: ActionCatalog,
  def: AutomationDefinition,
  action: string,
  args: Record<string, unknown>
): string | null {
  const entry = catalog.get(action)
  if (!entry) {
    return unknownAction(action)
  }
  const bad = entry.checkArgs(args)
  if (bad) {
    return bad
  }
  if (entry.power === null) {
    return `${entry.name} needs a person's approval; only Pilot asks for it`
  }
  return hasPower(entry, def)
    ? null
    : `"${def.name}" doesn't have the ${entry.power} power, so it can't propose ${entry.name}`
}

function parsed(output: string | null): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(output ?? 'null')
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function refreshedArgs(output: string | null): Record<string, unknown> | null {
  const args = parsed(output)?.args
  return args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : null
}

// Whether Pilot itself wrote this card's current args: it asked about the action (a run lacked the power;
// that ask is a row under the card refused with the outcome `asked`), and the card's args are the ones it
// asked with or ones a chain of its own refreshes produced from them. A refresh counts only when the args
// it refreshed were already Pilot's (its row's digest is of its input), walking the rows oldest first, so a
// refresh of args from anywhere else never makes its output Pilot's. Args changed any other way lose that.
function askedByPilot(store: PilotStore, card: InboxItemRow): boolean {
  const action = card.action ?? ''
  const made = new Set<string>()
  for (const row of store.actions.forInboxItem(card.id)) {
    if (row.action !== action) {
      continue
    }
    if (row.status === 'refused' && parsed(row.output)?.outcome === 'asked') {
      made.add(row.digest)
    }
    const args = row.phase === 'refresh' && row.status === 'done' ? refreshedArgs(row.output) : null
    if (args && made.has(row.digest)) {
      made.add(argsDigest(action, args))
    }
  }
  return made.has(argsDigest(action, card.actionArgs ?? {}))
}

// No catalog entry can leave parts out, so an approval that leaves any out is refused.
function leaveOut(
  entry: ActionEntry,
  args: Record<string, unknown>,
  leftOut: string[]
): { args: Record<string, unknown> } | { problem: string } {
  return leftOut.length === 0 ? { args } : { problem: `${entry.name} can't leave parts out` }
}

// A stored card is only a claim. Before its approval runs anything, the card must still be waiting, be for
// this action, run and version, not have run already, carry args that fit, and either come from an
// automation that has the power (re-read now: a power removed since takes the card's right with it) or be
// one Pilot asked about itself. What runs is the card's own args; an approval that leaves parts out is refused.
export function cardToRun(
  deps: PowersDeps,
  entry: ActionEntry,
  req: { runId: string | null; digest: string; leftOut?: string[] },
  id: string
): { args: Record<string, unknown> } | { problem: string } {
  const card = deps.store.inbox.get(id)
  if (!card) {
    return { problem: `No inbox item ${id}` }
  }
  const gate = evidenceGate(card)
  if (gate) {
    return { problem: gate }
  }
  if (card.action !== entry.name) {
    return { problem: `Card ${id} is for ${card.action ?? 'no action'}, not ${entry.name}` }
  }
  if (card.runId !== req.runId) {
    return {
      problem: `Card ${id} belongs to run ${card.runId ?? 'none'}, not ${req.runId ?? 'none'}`
    }
  }
  if (!WAITING.includes(card.status)) {
    return { problem: `Card ${id} is already ${card.status}` }
  }
  if (req.digest !== card.digest) {
    return { problem: `Card ${id} changed since it was approved` }
  }
  const ran = deps.store.actions
    .forInboxItem(id)
    .find((r) => r.phase === 'do' && !r.dryRun && (r.status === 'running' || r.status === 'done'))
  if (ran) {
    const when = ran.status === 'done' ? 'already ran' : 'is already running'
    return { problem: `Card ${id}'s action ${when}` }
  }
  const stored = card.actionArgs ?? {}
  const bad = entry.checkArgs(stored)
  if (bad) {
    return { problem: bad }
  }
  const def = definitionOf(deps, card.automationId)
  if (!def) {
    return { problem: `Card ${id}'s automation "${card.automationId}" isn't loaded; it can't run` }
  }
  if (!hasPower(entry, def) && !askedByPilot(deps.store, card)) {
    return {
      problem: `"${def.name}" doesn't have ${missingWhat(entry)} and Pilot didn't ask for card ${id}; it can't run`
    }
  }
  const out = approvedArgs(entry, card, req.leftOut ?? [])
  if ('problem' in out) {
    return out
  }
  const worse = entry.checkArgs(out.args)
  return worse ? { problem: worse } : out
}

// What a card's Approve runs: its stored args (no parts left out), pinned (a Linear write id) with the
// card attempt's key (its run, no step, the card, the action and those args). cardToRun runs exactly this,
// and the card's Run line (inbox/run-line.ts) shows exactly this: one function, so they can't disagree.
export function approvedArgs(
  entry: ActionEntry,
  card: InboxItemRow,
  leftOut: string[]
): { args: Record<string, unknown> } | { problem: string } {
  const out = leaveOut(entry, card.actionArgs ?? {}, leftOut)
  if ('problem' in out || !entry.pin) {
    return out
  }
  const key = stableJson([card.runId, null, card.id, entry.name, out.args])
  return { args: entry.pin(out.args, key) }
}
