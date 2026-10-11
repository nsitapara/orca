import type { ItemFields } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { EngineEnv } from '../engine-env'
import type { Item, RepoFacts } from '../sources/types'
import { worktreeActivity } from './agent-activity'
import { addCustomFields, type FieldCache } from './custom-fields'
import { quotaFields, readQuotas, type QuotaReaders } from './quota'
import type { ScriptRunner } from './script-runner'
import {
  NO_WORKTREE,
  worktreeFacts,
  worktreeFor,
  type WorktreeFactDeps,
  type WorktreeInfo
} from './worktree-facts'

// One import for the tick: built-ins here, custom field scripts from custom-fields.ts.
export { addCustomFields }

export type FieldEngineDeps = WorktreeFactDeps & {
  quotas: QuotaReaders
  // This automation's answers on the item that are saved but not yet dispatched (QueueStore.pendingAnswerCount).
  pendingAnswers(automationId: string, itemKey: string): number
  cache: FieldCache
  runScript: ScriptRunner
  engineEnv: EngineEnv
  now(): number
}

function repoFields(repo: RepoFacts): ItemFields {
  return { 'repo.name': repo.name, 'repo.path': repo.path, 'repo.base': repo.base }
}

function pendingAnswers(
  deps: FieldEngineDeps,
  automationId: string,
  itemKey: string
): number | null {
  try {
    return deps.pendingAnswers(automationId, itemKey)
  } catch {
    return null
  }
}

// Built-in fields for every listed item (spec §5), in or out of scope, so items.match can use
// them: repo, worktree facts (each worktree read once), both agents' quota, and this automation's
// answers still waiting to be applied on the item. A failed worktree listing throws, so the tick fails and retries.
export async function addBuiltinFields(
  def: AutomationDefinition,
  items: Item[],
  repo: RepoFacts,
  deps: FieldEngineDeps
): Promise<Item[]> {
  const worktrees = await deps.listWorktrees(repo.path)
  const matched = items.map((item) => worktreeFor(item, worktrees, repo.path))
  const activity = await worktreeActivity(
    matched.flatMap((w) => (w ? [w.path] : [])),
    deps
  )
  const quota = quotaFields(await readQuotas(deps.quotas))
  const base = repoFields(repo)
  const facts = new Map<string, Promise<ItemFields>>()
  const factsOf = (wt: WorktreeInfo): Promise<ItemFields> => {
    let read = facts.get(wt.path)
    if (!read) {
      read = worktreeFacts(wt, def.id, activity, deps)
      facts.set(wt.path, read)
    }
    return read
  }
  return Promise.all(
    items.map(async (item, i) => {
      const wt = matched[i]
      const worktree = wt ? await factsOf(wt) : NO_WORKTREE
      return {
        ...item,
        fields: {
          ...item.fields,
          ...base,
          ...worktree,
          ...quota,
          'inbox.pending_answers': pendingAnswers(deps, def.id, item.key)
        }
      }
    })
  )
}
