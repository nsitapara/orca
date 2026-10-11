import { readFileSync } from 'node:fs'
import type {
  ActivityTick,
  AutomationDetailPayload,
  AutomationListPayload,
  AutomationSummary
} from '../../shared/api-types'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { AutomationDefinition, ParseResult } from '../../shared/definition/types'
import { checkName } from '../../shared/tick/checks'
import type { PilotContext } from '../pilot-services'

const ITEM_KIND: Record<string, string> = { merge_request: 'Merge requests' }

// Every valid M1 file has items: (run-once automations arrive in M3).
function itemKindLabel(def: AutomationDefinition): string {
  return ITEM_KIND[def.items.kind] ?? def.items.kind
}

function summarize(ctx: PilotContext, def: AutomationDefinition): AutomationSummary {
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
    nextTickAt: ctx.scheduler.nextTickAt(def),
    lastTick: ctx.store.lastTick(def.id)
  }
}

export function listAutomations(ctx: PilotContext): AutomationListPayload {
  const loaded = ctx.loaded()
  return {
    automations: loaded.definitions.map((d) => summarize(ctx, d)),
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
    checkNames: def.checks.map(checkName)
  }
}

// Newest first. An id with no ticks (or no such automation) gives an empty list.
export function activity(ctx: PilotContext, id: string, limit: number): ActivityTick[] {
  return ctx.store.listTicks(id, limit).map((tick) => ({
    ...tick,
    items: ctx.store.tickItems(tick.id),
    runs: ctx.store.runs
      .forTick(tick.id)
      .map((run) => ({ ...run, steps: ctx.store.runs.steps(run.id) }))
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
