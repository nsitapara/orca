import type { FieldValue, ItemFields } from '../../shared/api-types'
import type { AutomationDefinition, ItemKind } from '../../shared/definition/types'
import { engineChildEnv, type EngineEnv } from '../engine-env'
import { mapLimit } from '../map-limit'
import type { PassFetchCache } from '../sources/fetch-cache'
import type { Item } from '../sources/types'
import type { FieldCacheStore } from '../store/store-fields'
import { resolveScriptCommand, type ScriptRunner } from './script-runner'

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
type FieldRun = { value: FieldValue; ok: boolean; warning: string | null }

const PREFIX: Record<ItemKind, string> = {
  merge_request: 'mr',
  worktree: 'worktree',
  pipeline: 'pipeline',
  linear_ticket: 'ticket',
  inbox_preparation: 'preparation'
}
const ITEM_CONCURRENCY = 4

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function lastLine(text: string): string {
  return text.trim().split('\n').at(-1)?.trim() ?? ''
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
    warning: `Field ${name} for ${item.label} ${warning}`
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
  if (result.code !== 0) {
    const why = lastLine(result.stderr) || lastLine(result.stdout)
    return failed(why ? `exited ${result.code}: ${why}` : `exited ${result.code}`)
  }
  return { value: parseFieldOutput(result.stdout), ok: true, warning: null }
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
): Promise<{ item: Item; warnings: string[] }> {
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
    if (run.warning) {
      warnings.push(run.warning)
    }
    if (run.ok && cacheKey !== null) {
      try {
        deps.cache.set(def.id, name, item.key, cacheKey, run.value, deps.now())
      } catch {}
    }
  }
  return { item: { ...item, fields }, warnings }
}

// Custom field scripts (spec §5), only for items the source kept in scope.
export async function addCustomFields(
  def: AutomationDefinition,
  items: Item[],
  opts: { inScope(item: Item): boolean; repoPath: string; pass: PassFetchCache },
  deps: CustomFieldDeps
): Promise<{ items: Item[]; warnings: string[] }> {
  const kind = def.items?.kind
  if (!kind || def.items?.customFields.length === 0) {
    return { items, warnings: [] }
  }
  const results = await mapLimit(items, ITEM_CONCURRENCY, async (item) => {
    if (!opts.inScope(item)) {
      return { item, warnings: [] }
    }
    return fieldsFor(def, kind, item, opts.repoPath, opts.pass, deps)
  })
  return { items: results.map((r) => r.item), warnings: results.flatMap((r) => r.warnings) }
}
