import { readFileSync } from 'node:fs'
import type {
  ActivityTick,
  AutomationDetailPayload,
  AutomationListPayload,
  AutomationSummary
} from '../../shared/api-types'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { AutomationDefinition, ItemKind, ParseResult } from '../../shared/definition/types'
import { checkName } from '../../shared/tick/checks'
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
  return {
    summary: summarize(ctx, def),
    yaml: readFileSync(def.file, 'utf8'),
    checkNames: def.checks.map(checkName),
    steps: def.steps
  }
}

// Newest first. An id with no ticks (or no such automation) gives an empty list. Each run carries its steps and
// what it asked (open and answered inbox items), for Activity and the Agent Console.
export function activity(ctx: PilotContext, id: string, limit: number): ActivityTick[] {
  const ticks = ctx.store
    .listTicks(id, limit)
    .map((tick) => ({ tick, runs: ctx.store.runs.forTick(tick.id) }))
  const asked = ctx.store.timeline.inboxForRuns(ticks.flatMap((t) => t.runs.map((r) => r.id)))
  return ticks.map(({ tick, runs }) => ({
    ...tick,
    items: ctx.store.tickItems(tick.id),
    runs: runs.map((run) => ({
      ...run,
      steps: ctx.store.runs.steps(run.id),
      inbox: asked.filter((i) => i.runId === run.id)
    }))
  }))
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
