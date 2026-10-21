import type { FieldValue, ItemFields } from '../../shared/api-types'
import type { AutomationDefinition, ItemKind } from '../../shared/definition/types'
import { engineChildEnv, type EngineEnv } from '../engine-env'
import { mapLimit } from '../map-limit'
import type { PassFetchCache } from '../sources/fetch-cache'
import type { Item } from '../sources/types'
import type { FieldCacheStore } from '../store/store-fields'
import { resolveScriptCommand, type ScriptRunner } from './script-runner'
import { lastLine } from '../last-line'

// Backed by the field_cache table (store.fields, Task 1c): one row per (automation, field, item); a
// row stored under another cache key reads null.
export type FieldCache = Pick<FieldCacheStore, 'get' | 'set'>
export type CustomFieldDeps = {
  cache: FieldCache
  runScript: ScriptRunner
  engineEnv: EngineEnv
  now(): number
}
type CustomField = NonNullable<AutomationDefinition['items']>['customFields'][number]
type FieldRun = { value: FieldValue; ok: boolean; warning: string | null; notDue: string | null }

// A field script's exit for "this item isn't due now": skipped this tick (README: Field scripts).
export const NOT_DUE_EXIT = 3

const PREFIX: Record<ItemKind, string> = {
  merge_request: 'mr',
  worktree: 'worktree',
  pipeline: 'pipeline',
  linear_ticket: 'ticket',
  inbox_preparation: 'preparation',
  kept_branch: 'kept'
}
const ITEM_CONCURRENCY = 4

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// JSON when stdout parses to a string, number, boolean or null; otherwise the trimmed text.
export function parseFieldOutput(stdout: string): FieldValue {
  const text = stdout.trim()
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || ['string', 'number', 'boolean'].includes(typeof parsed)) {
      return parsed as FieldValue
    }
  } catch {}
  return text
}

// per_tick: one value per scheduler pass. per_head: one per commit, keyed by the MR's head sha, else
// the worktree's head; with neither it isn't cached.
export function cacheKeyFor(
  cache: CustomField['cache'],
  fields: ItemFields,
  pass: PassFetchCache
): string | null {
  if (cache === 'per_tick') {
    return pass.passId
  }
  const head = fields['mr.head_sha'] ?? fields['worktree.head']
  if (typeof head === 'string' && head !== '') {
    return head
  }
  return null
}

async function runField(
  def: AutomationDefinition,
  field: CustomField,
  name: string,
  item: Item,
  repoPath: string,
  deps: CustomFieldDeps
): Promise<FieldRun> {
  const failed = (warning: string): FieldRun => ({
    value: null,
    ok: false,
    warning: `Field ${name} for ${item.label} ${warning}`,
    notDue: null
  })
  let result
  try {
    result = await deps.runScript({
      command: resolveScriptCommand(field.script, def.file),
      cwd: repoPath,
      stdin: JSON.stringify({ key: item.key, label: item.label, fields: item.fields }),
      env: engineChildEnv(deps.engineEnv, {
        PILOT_AUTOMATION_ID: def.id,
        PILOT_ITEM_KEY: item.key,
        PILOT_FIELD: name
      }),
      timeoutMs: field.timeoutMs
    })
  } catch (error) {
    return failed(`couldn't start: ${messageOf(error)}`)
  }
  if (result.timedOut) {
    return failed(`timed out after ${Math.round(field.timeoutMs / 1000)}s`)
  }
  if (result.code === NOT_DUE_EXIT) {
    // As check: { run } reads a verdict: stdout's last line first.
    const said = lastLine(result.stdout) || lastLine(result.stderr)
    return {
      value: null,
      ok: false,
      warning: null,
      notDue: said || `Field ${name} isn't due now (exit 3)`
    }
  }
  if (result.code !== 0) {
    const why = lastLine(result.stderr) || lastLine(result.stdout)
    return failed(why ? `exited ${result.code}: ${why}` : `exited ${result.code}`)
  }
  return { value: parseFieldOutput(result.stdout), ok: true, warning: null, notDue: null }
}

function cached(
  deps: CustomFieldDeps,
  ...key: [string, string, string, string]
): FieldValue | undefined {
  try {
    return deps.cache.get(...key)?.value
  } catch {
    return undefined
  }
}

async function fieldsFor(
  def: AutomationDefinition,
  kind: ItemKind,
  item: Item,
  repoPath: string,
  pass: PassFetchCache,
  deps: CustomFieldDeps
): Promise<{ item: Item; warnings: string[]; notDue: string | null }> {
  const fields: ItemFields = { ...item.fields }
  const warnings: string[] = []
  for (const field of def.items?.customFields ?? []) {
    const name = `${PREFIX[kind]}.${field.name}`
    const cacheKey = cacheKeyFor(field.cache, fields, pass)
    const hit = cacheKey === null ? undefined : cached(deps, def.id, name, item.key, cacheKey)
    if (hit !== undefined) {
      fields[name] = hit
      continue
    }
    const run = await runField(def, field, name, { ...item, fields }, repoPath, deps)
    fields[name] = run.value
    if (run.notDue !== null) {
      // Skipped this tick: its later field scripts don't run, and the cache keeps nothing (run.ok is false).
      return { item: { ...item, fields }, warnings, notDue: run.notDue }
    }
    if (run.warning) {
      warnings.push(run.warning)
    }
    if (run.ok && cacheKey !== null) {
      try {
        deps.cache.set(def.id, name, item.key, cacheKey, run.value, deps.now())
      } catch {}
    }
  }
  return { item: { ...item, fields }, warnings, notDue: null }
}

// Custom field scripts (spec §5), only for items the source kept in scope. notDue: the items a script said aren't due now
// (exit 3), by key, with its reason.
export async function addCustomFields(
  def: AutomationDefinition,
  items: Item[],
  opts: { inScope(item: Item): boolean; repoPath: string; pass: PassFetchCache },
  deps: CustomFieldDeps
): Promise<{ items: Item[]; warnings: string[]; notDue: Map<string, string> }> {
  const notDue = new Map<string, string>()
  const kind = def.items?.kind
  if (!kind || def.items?.customFields.length === 0) {
    return { items, warnings: [], notDue }
  }
  const results = await mapLimit(items, ITEM_CONCURRENCY, async (item) => {
    if (!opts.inScope(item)) {
      return { item, warnings: [], notDue: null }
    }
    return fieldsFor(def, kind, item, opts.repoPath, opts.pass, deps)
  })
  for (const r of results) {
    if (r.notDue !== null) {
      notDue.set(r.item.key, r.notDue)
    }
  }
  return { items: results.map((r) => r.item), warnings: results.flatMap((r) => r.warnings), notDue }
}
