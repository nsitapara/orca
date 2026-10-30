import { z } from 'zod'

// What Pilot reads of `pilotcli artifacts list-artifacts --format json --limit 0` (pilotCLI
// docs/specs/2026-10-30-artifacts-index-design.md, "Output contract"). zod drops every field not named here. A field a
// row lacks takes its empty value, so one odd row can't hide the rest; a row without an id or url is dropped.

export const ARTIFACT_ROLES = [
  'interactive',
  'sub-issue-worker',
  'mockup-keeper',
  'drive',
  'job'
] as const
export type ArtifactRole = (typeof ARTIFACT_ROLES)[number]

const text = z.string().catch('')
const texts = z.array(z.string()).catch([])
const count = z.number().int().nonnegative().catch(0)

export const ArtifactContributionSchema = z.object({
  session_id: text,
  role: text,
  job: text,
  worktree: text,
  branch: text,
  publishes: count,
  first: text,
  last: text
})
export type ArtifactContribution = z.infer<typeof ArtifactContributionSchema>

export const AgentArtifactSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['claude', 'local']).catch('claude'),
  url: z.string().min(1),
  title: text,
  description: text,
  tickets: texts,
  worktrees: texts,
  versions: count,
  first_published: text,
  last_published: text,
  tracked: z.boolean().catch(true),
  on_account: z.boolean().catch(false),
  job: text,
  contributions: z.array(ArtifactContributionSchema).catch([]),
  source_files: texts,
  vault_notes: texts
})
export type AgentArtifact = z.infer<typeof AgentArtifactSchema>

export const ArtifactsListParams = z.object({ refresh: z.boolean().optional() })
export type ArtifactsListParams = z.infer<typeof ArtifactsListParams>

// The index as Pilot last read it. `artifacts` is the last good read, kept while a later read fails (`error` says
// why); `refreshing` is true while a read runs, so the caller asks again for its answer.
export type ArtifactsPayload = {
  fetchedAt: number | null
  artifacts: AgentArtifact[]
  error: string | null
  refreshing: boolean
}

export function isArtifactsPayload(value: unknown): value is ArtifactsPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'artifacts' in value &&
    Array.isArray(value.artifacts) &&
    'refreshing' in value &&
    typeof value.refreshing === 'boolean'
  )
}
