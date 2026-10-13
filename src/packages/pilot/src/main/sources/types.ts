import type { z } from 'zod'
import type { ItemFields, ScopeResult } from '../../shared/api-types'
import type { ItemKind } from '../../shared/definition/types'
import type { PeopleDirectory } from '../../shared/people'
import type { PassFetchCache } from './fetch-cache'

// The repo an automation runs on: its name as the automation gives it, Orca's id and main checkout,
// and the base ref Orca creates its worktrees from (null when the repo sets none).
export type RepoFacts = { name: string; id: string; path: string; base: string | null }

export type Item = {
  kind: ItemKind | 'repo'
  // mr:<iid> | wt:<worktreeId> | pipeline:<id> | linear:<IDENT> | repo:<repo>
  key: string
  label: string
  // Flat dotted keys (mr.iid, worktree.path, …), values string | number | boolean | null.
  fields: ItemFields
  // How to find the item's worktree: merge requests by branch (contract §3).
  worktreeHint: { id?: string; path?: string; branch?: string; linearIssue?: string } | null
  sortKeys: { waitingSince: number | null; priority: number | null }
}

export type SourceContext = {
  repo: RepoFacts
  people: PeopleDirectory | null
  fetch: PassFetchCache
  now: number
  automationId: string
  // where.ids_from's ids: the source reads these alone instead of listing. null (or absent): no ids_from.
  ids?: readonly string[] | null
}

// One per item kind (contract §3). A type, not an interface: the repo's lint asks for types.
export type ItemSource = {
  kind: ItemKind
  // The kind's schema from shared/definition/where.ts: the same object parse.ts checks files with.
  whereSchema: z.ZodType
  list(ctx: SourceContext, where: unknown): Promise<{ items: Item[]; warnings: string[] }>
  scope(item: Item, where: unknown, people: PeopleDirectory | null): ScopeResult
}
