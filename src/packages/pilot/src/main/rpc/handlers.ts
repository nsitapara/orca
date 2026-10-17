import { readFileSync } from 'node:fs'
import type {
  ActivityTick,
  AutomationDetailPayload,
  AutomationListPayload,
  ActivityRun,
  AutomationSummary
} from '../../shared/api-types'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { AutomationDefinition, ParseResult } from '../../shared/definition/types'
import { chainOf } from '../../shared/run-views/chain'
import { itemKindWords } from '../../shared/run-views/chain-text'
import { checkName } from '../../shared/tick/checks'
import { HANDOVER_EXPIRED_EVENT } from '../handover/housekeep'
import type { PilotContext } from '../pilot-services'
import { withDetail } from '../timeline/run-detail'
import { activityTicks, noteOf } from './activity-ticks'

// heldBack: its file is invalid and only its last valid version is shown, so it has no next tick. `live`: its runs still
// going or waiting on a person.
function summarize(
  ctx: PilotContext,
  def: AutomationDefinition,
  live: ActivityRun[],
  heldBack = false
): AutomationSummary {
  return {
    id: def.id,
    name: def.name,
    file: def.file,
    enabled: def.enabled,
    schedule: def.schedule,
    timezone: def.timezone,
    itemKind: itemKindWords(def),
    agent: def.steps[0]?.agent ?? 'claude',
    powers: def.powers,
    inbox: def.inbox,
    nextTickAt: heldBack ? null : ctx.scheduler.nextTickAt(def),
    lastTick: ctx.store.lastTick(def.id),
    job: def.job,
    chain: chainOf(def, ctx.loaded().definitions),
    live
  }
}

export function listAutomations(ctx: PilotContext): AutomationListPayload {
  const loaded = ctx.loaded()
  const displayOnly = new Set(loaded.displayOnly ?? [])
  const live = withDetail(ctx.store, ctx.store.activity.live(null))
  return {
    automations: loaded.definitions.map((d) =>
      summarize(
        ctx,
        d,
        live.filter((r) => r.automationId === d.id),
        displayOnly.has(d.id)
      )
    ),
    errors: loaded.errors,
    warnings: loaded.warnings ?? [],
    peopleError: loaded.peopleError,
    missingDirs: loaded.missingDirs
  }
}

function findDefinition(ctx: PilotContext, id: string): AutomationDefinition {
  const def = ctx.loaded().definitions.find((d) => d.id === id)
  if (!def) {
    throw new Error(`No automation "${id}"`)
  }
  return def
}

export function getAutomation(ctx: PilotContext, id: string): AutomationDetailPayload {
  const def = findDefinition(ctx, id)
  const passing = (def.job?.feeds ?? []).filter((f) => f.pass !== null)
  return {
    summary: summarize(ctx, def, withDetail(ctx.store, ctx.store.activity.live([def.id]))),
    yaml: readFileSync(def.file, 'utf8'),
    checkNames: def.checks.map(checkName),
    handovers: passing.map((f) => ({ to: f.to, rows: ctx.store.handovers.latest(def.id, f.to) })),
    notes: earlyNotes(ctx, def.id)
  }
}

// Newest first. An id with no ticks (or no such automation) gives an empty list. Each run carries its steps and
// what it asked (open and answered inbox items), for Activity; each tick, what triggered it and
// the handed-over ids it read. `skipQuiet`: only the ticks that had something to do (the store's QUIET_TICK).
export function activity(
  ctx: PilotContext,
  id: string,
  limit: number,
  { skipQuiet = false }: { skipQuiet?: boolean } = {}
): ActivityTick[] {
  const ticks = ctx.store.listTicks(id, limit, skipQuiet)
  const oldest = ticks.at(-1)
  // Fewer ticks than asked for: every note of this stage belongs under one of them.
  const floor = ticks.length < limit || !oldest ? 0 : oldest.startedAt
  return activityTicks(ctx, ticks, floor)
}

// A stage's notes from before its first tick (or all of them, if it never ticked): no tick to sit under, so Activity
// shows them as entries of their own.
function earlyNotes(ctx: PilotContext, id: string): { at: number; text: string }[] {
  const first = ctx.store.handovers.firstTickAt(id)
  return ctx.store.events
    .list({ kinds: [HANDOVER_EXPIRED_EVENT], automationId: id })
    .filter((e) => first === null || e.at < first)
    .map(noteOf)
}

// Parse only. `file` is a label for error messages and the source of the id; it is never opened.
export function validateYaml(yaml: string, file: string): ParseResult {
  return parseAutomationYaml(yaml, file)
}

export async function dryRun(ctx: PilotContext, id: string) {
  findDefinition(ctx, id)
  return ctx.scheduler.tickNow(id, { dryRun: true })
}

export async function tickNow(ctx: PilotContext, id: string) {
  findDefinition(ctx, id)
  return ctx.scheduler.tickNow(id, { dryRun: false, byHand: true })
}
