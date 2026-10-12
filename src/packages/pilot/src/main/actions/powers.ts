import type { AutomationDefinition } from '../../shared/definition/types'
import { WAITING } from '../inbox/inbox-service'
import type { PilotStore } from '../store/store'
import type { ActionCatalog, ActionEntry } from './types'

// Who may do or propose what (spec §6 "Powers"). Fail closed: anything not shown allowed is refused.

export type PowersDeps = { store: PilotStore; definitions(): AutomationDefinition[] }

export const unknownAction = (name: string): string =>
  `No action named "${name}" in Pilot's catalog`

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

function outcomeOf(output: string | null): unknown {
  try {
    return (JSON.parse(output ?? 'null') as { outcome?: unknown } | null)?.outcome
  } catch {
    return null
  }
}

// Whether Pilot itself wrote this card to ask about its action (a run lacked the power): that ask is an
// action_runs row under the card, refused with the outcome `asked` (other refusals are `failed`).
function askedByPilot(store: PilotStore, cardId: string, action: string): boolean {
  return store.actions
    .forInboxItem(cardId)
    .some((r) => r.status === 'refused' && r.action === action && outcomeOf(r.output) === 'asked')
}

// A stored card is only a claim. Before its approval runs anything, the card must still be waiting, be for
// this action, run and version, carry args that fit, and either come from an automation that has the power
// (re-read now: a power removed since takes the card's right to run with it) or be one Pilot asked about.
export function approvedCardProblem(
  deps: PowersDeps,
  entry: ActionEntry,
  req: { runId: string | null; digest?: string },
  id: string
): string | null {
  const card = deps.store.inbox.get(id)
  if (!card) {
    return `No inbox item ${id}`
  }
  if (card.action !== entry.name) {
    return `Card ${id} is for ${card.action ?? 'no action'}, not ${entry.name}`
  }
  if (card.runId !== req.runId) {
    return `Card ${id} belongs to run ${card.runId ?? 'none'}, not ${req.runId ?? 'none'}`
  }
  if (!WAITING.includes(card.status)) {
    return `Card ${id} is already ${card.status}`
  }
  if (req.digest !== undefined && req.digest !== card.digest) {
    return `Card ${id} changed since it was approved`
  }
  const bad = entry.checkArgs(card.actionArgs ?? {})
  if (bad) {
    return bad
  }
  const def = definitionOf(deps, card.automationId)
  if (!def) {
    return `Card ${id}'s automation "${card.automationId}" isn't loaded; it can't run`
  }
  if (hasPower(entry, def) || askedByPilot(deps.store, id, entry.name)) {
    return null
  }
  return `"${def.name}" doesn't have ${missingWhat(entry)} and Pilot didn't ask for card ${id}; it can't run`
}
