import { readFileSync } from 'node:fs'
import type {
  ActivityTick,
  AutomationDetailPayload,
  AutomationListPayload,
  AutomationSummary,
  TickRow
} from '../../shared/api-types'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { AutomationDefinition, ItemKind, ParseResult } from '../../shared/definition/types'
import { checkName } from '../../shared/tick/checks'
import { HANDOVER_EXPIRED_EVENT } from '../handover/housekeep'
import type { PilotContext } from '../pilot-services'

const ITEM_KIND: Record<ItemKind, string> = {
  merge_request: 'Merge requests',
  worktree: 'Worktrees',
  pipeline: 'Pipelines',
  linear_ticket: 'Linear tickets',
  inbox_preparation: 'Inbox context requests'
}

function itemKindLabel(def: AutomationDefinition): string {
  if (!def.items) {
    return 'Runs once'
  }
  return ITEM_KIND[def.items.kind]
}

// heldBack: its file is invalid and only its last valid version is shown, so it has no next tick.
function summarize(
  ctx: PilotContext,
  def: AutomationDefinition,
  heldBack = false
): AutomationSummary {
  return {
    id: def.id,
    name: def.name,
    file: def.file,
    enabled: def.enabled,
    schedule: def.schedule,
    timezone: def.timezone,
    itemKind: itemKindLabel(def),
    agent: def.steps[0]?.agent ?? 'claude',
    powers: def.powers,
    inbox: def.inbox,
    nextTickAt: heldBack ? null : ctx.scheduler.nextTickAt(def),
    lastTick: ctx.store.lastTick(def.id),
    job: def.job
  }
}

export function listAutomations(ctx: PilotContext): AutomationListPayload {
  const loaded = ctx.loaded()
  const displayOnly = new Set(loaded.displayOnly ?? [])
  return {
    automations: loaded.definitions.map((d) => summarize(ctx, d, displayOnly.has(d.id))),
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
    summary: summarize(ctx, def),
    yaml: readFileSync(def.file, 'utf8'),
    checkNames: def.checks.map(checkName),
    steps: def.steps,
    handovers: passing.map((f) => ({ to: f.to, rows: ctx.store.handovers.latest(def.id, f.to) }))
  }
}

// Newest first. An id with no ticks (or no such automation) gives an empty list. Each run carries its steps and
// what it asked (open and answered inbox items), for Activity and the Agent Console; each tick, what triggered it and
// the handed-over ids it read.
export function activity(ctx: PilotContext, id: string, limit: number): ActivityTick[] {
  const ticks = ctx.store
    .listTicks(id, limit)
    .map((tick) => ({ tick, runs: ctx.store.runs.forTick(tick.id) }))
  const asked = ctx.store.timeline.inboxForRuns(ticks.flatMap((t) => t.runs.map((r) => r.id)))
  const tickIds = ticks.map((t) => t.tick.id)
  const triggers = ctx.store.handovers.tickTriggers(tickIds)
  const handedOver = ctx.store.handovers.consumedBy(tickIds)
  const definitions = ctx.loaded().definitions
  const stageOf = (id: string) => definitions.find((d) => d.id === id)?.job?.stage ?? null
  const notes = notesByTick(
    ctx,
    id,
    ticks.map((t) => t.tick),
    limit
  )
  return ticks.map(({ tick, runs }) => ({
    ...tick,
    trigger: triggers.get(tick.id) ?? null,
    handedOver: (handedOver.get(tick.id) ?? []).map((h) => ({
      ...h,
      senderStage: stageOf(h.senderId)
    })),
    notes: notes.get(tick.id) ?? [],
    items: ctx.store.tickItems(tick.id),
    runs: runs.map((run) => ({
      ...run,
      steps: ctx.store.runs.steps(run.id),
      inbox: asked.filter((i) => i.runId === run.id)
    }))
  }))
}

// Each expiry the scheduler pass recorded on this stage, under the newest tick that started before it (ticks newest
// first). One older than every tick shown belongs to a tick past the list, unless the list holds every tick.
function notesByTick(
  ctx: PilotContext,
  id: string,
  ticks: readonly TickRow[],
  limit: number
): Map<number, { at: number; text: string }[]> {
  const found = new Map<number, { at: number; text: string }[]>()
  const oldest = ticks.at(-1)
  if (!oldest) {
    return found
  }
  const since = ticks.length < limit ? 0 : oldest.startedAt
  const events = ctx.store.events.list({ kinds: [HANDOVER_EXPIRED_EVENT], automationId: id, since })
  for (const e of events) {
    const tick = ticks.find((t) => t.startedAt <= e.at) ?? oldest
    const text = typeof e.payload.text === 'string' ? e.payload.text : e.kind
    found.set(tick.id, [...(found.get(tick.id) ?? []), { at: e.at, text }])
  }
  return found
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
  return ctx.scheduler.tickNow(id, { dryRun: false })
}
