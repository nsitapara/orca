import type { ItemFields, ScopeResult } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { PeopleDirectory } from '../../shared/people'
import { runFields } from '../../shared/template'
import { IN_SCOPE } from '../../shared/tick/scope'
import { addQuotaFields, type QuotaReader } from '../fields/quota'
import { addWorktreeFields, type FactDeps } from '../fields/worktree-fields'
import type { PassFetchCache } from '../sources/fetch-cache'
import { itemSource } from '../sources/registry'
import { repoFields, runOnceItem } from '../sources/run-once'
import type { Item, RepoFacts } from '../sources/types'

// `quota` should be the cached reader in production; a throw is still fail-open (nulls).
export type ItemDeps = {
  now(): number
  resolveRepo(repo: string): Promise<RepoFacts>
  facts: FactDeps
  quota: QuotaReader
}
export type GatheredItems = { items: Item[]; scope(item: Item): ScopeResult }

const NO_QUOTA = { weekly: null, session: null }

// M1's rule: worktree facts only for MRs with a pipeline. Task 5 reads them for every item with a worktree.
function needsWorktreeFacts(item: Item): boolean {
  return item.kind === 'merge_request' && item.fields['mr.pipeline'] !== null
}

async function listed(
  def: AutomationDefinition,
  people: PeopleDirectory,
  repo: RepoFacts,
  pass: PassFetchCache,
  now: number
): Promise<GatheredItems> {
  if (def.items === null) {
    return { items: [runOnceItem(repo)], scope: () => IN_SCOPE }
  }
  const source = itemSource(def.items.kind)
  const where = def.items.where
  const result = await source.list({ repo, people, fetch: pass, now, automationId: def.id }, where)
  for (const warning of result.warnings) {
    console.warn(`[pilot] ${def.id}: ${warning}`)
  }
  return { items: result.items, scope: (item) => source.scope(item, where, people) }
}

// One tick's items: listed by the kind's source (or the run-once item), with repo.* and run.* (the
// tick's id as run.tick, no run.id before a run exists), worktree and quota fields. An item's own
// fields win over the tick's.
export async function gatherItems(
  def: AutomationDefinition,
  people: PeopleDirectory,
  deps: ItemDeps,
  pass: PassFetchCache,
  tickId: number
): Promise<GatheredItems> {
  const repo = await deps.resolveRepo(def.repo)
  const now = deps.now()
  const { items, scope } = await listed(def, people, repo, pass, now)
  const tickFields: ItemFields = {
    ...repoFields(repo),
    ...runFields({ automationId: def.id, at: now, timezone: def.timezone, tickId })
  }
  const withTick = items.map((item) => ({ ...item, fields: { ...tickFields, ...item.fields } }))
  const withFacts = await addWorktreeFields(
    withTick,
    def.id,
    repo.path,
    deps.facts,
    needsWorktreeFacts
  )
  const quota = await deps.quota().catch(() => NO_QUOTA)
  return { items: addQuotaFields(withFacts, quota), scope }
}
