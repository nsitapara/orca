import type { ItemFields } from '../../shared/api-types'
import type { MergeRequestWhere } from '../../shared/definition/types'
import { WHERE_SCHEMAS, mergeRequestWhereSchema } from '../../shared/definition/where'
import { EMPTY_PEOPLE, gitlabHandlesFor, type PeopleDirectory } from '../../shared/people'
import { mergeRequestListScope, mergeRequestScope } from '../../shared/tick/scope'
import { mapLimit } from '../map-limit'
import { gateFields, readApprovers, readBranchFacts } from './branch-facts'
import type { GlabApi } from './gitlab-api'
import { MAX_PAGES, PER_PAGE, gitlabFor, messageOf, pageAll } from './gitlab-fetch'
import { readWaitingThreads } from './mr-threads'
import type { Item, ItemSource, SourceContext } from './types'

type GitLabMR = {
  iid: number
  title: string
  source_branch: string
  target_branch?: string
  author: { username: string; name?: string }
  state: string
  draft?: boolean
  labels?: string[]
  reviewers?: { username: string }[]
  web_url?: string
  sha?: string
}
type GitLabMRDetail = GitLabMR & {
  head_pipeline: { id: number; status: string } | null
  changes_count?: string | null
}

const POOL = 3
const STATE: Record<string, string> = {
  opened: 'open',
  merged: 'merged',
  closed: 'closed',
  locked: 'locked'
}

export function shortBranch(branch: string): string {
  const ticket = /^web-\d+/.exec(branch)
  if (ticket) {
    return ticket[0]
  }
  return branch.length > 28 ? `${branch.slice(0, 27)}…` : branch
}

function short(sha: string | null): string | null {
  return sha ? sha.slice(0, 8) : null
}

// GitLab gives "12", or "1000+" past its counting limit.
function changesCount(raw: string | null | undefined): number | string | null {
  if (raw === null || raw === undefined) {
    return null
  }
  return /^\d+$/.test(raw) ? Number(raw) : raw
}

function listFields(mr: GitLabMR): ItemFields {
  const sha = mr.sha ?? null
  return {
    'mr.iid': mr.iid,
    'mr.title': mr.title,
    'mr.branch': mr.source_branch,
    'mr.target_branch': mr.target_branch ?? null,
    'mr.author': mr.author.username,
    'mr.author_name': mr.author.name ?? null,
    'mr.state': STATE[mr.state] ?? mr.state,
    'mr.draft': mr.draft ?? false,
    'mr.labels': (mr.labels ?? []).join(','),
    'mr.reviewers': (mr.reviewers ?? []).map((r) => r.username).join(','),
    'mr.web_url': mr.web_url ?? null,
    'mr.head_sha': sha,
    'mr.head_short': short(sha),
    'mr.changes_count': null,
    'mr.pipeline': null,
    'mr.pipeline_status': null,
    'mr.approved_by': null,
    'mr.approved_count': null,
    'mr.waiting_threads': null
  }
}

// GitLab is asked only for the people the automation is about: its reviewers when it names them (09),
// else its authors (05, 06), else every open MR.
function listPaths(where: MergeRequestWhere, people: PeopleDirectory): string[] {
  const reviewers = gitlabHandlesFor(where.reviewer, people)
  if (reviewers !== null) {
    return reviewers.map(
      (h) => `merge_requests?state=opened&reviewer_username=${encodeURIComponent(h)}`
    )
  }
  const authors = gitlabHandlesFor(where.author, people)
  if (authors !== null) {
    return authors.map(
      (h) => `merge_requests?state=opened&author_username=${encodeURIComponent(h)}`
    )
  }
  return ['merge_requests?state=opened']
}

async function listOpen(
  ctx: SourceContext,
  api: GlabApi,
  where: MergeRequestWhere,
  people: PeopleDirectory,
  warnings: string[]
): Promise<GitLabMR[]> {
  const byIid = new Map<number, GitLabMR>()
  for (const path of listPaths(where, people)) {
    const { items, capped } = await pageAll<GitLabMR>(ctx, api, path)
    if (capped) {
      warnings.push(
        `${api.projectPath}: stopped at ${PER_PAGE * MAX_PAGES} open MRs (${path}); later ones are not checked`
      )
    }
    for (const mr of items) {
      byIid.set(mr.iid, mr)
    }
  }
  return [...byIid.values()].sort((a, b) => a.iid - b.iid)
}

function warn(warnings: string[], iid: number, what: string, error: unknown): null {
  warnings.push(`!${iid}: couldn't read its ${what}: ${messageOf(error)}`)
  return null
}

function asItem(mr: GitLabMR, fields: ItemFields): Item {
  return {
    kind: 'merge_request',
    key: `mr:${mr.iid}`,
    label: `!${mr.iid} ${shortBranch(mr.source_branch)}`,
    fields,
    worktreeHint: { branch: mr.source_branch },
    sortKeys: { waitingSince: null, priority: null }
  }
}

async function detailedFields(
  ctx: SourceContext,
  api: GlabApi,
  mr: GitLabMR,
  warnings: string[]
): Promise<ItemFields> {
  // A failed details read rejects the whole list: the tick fails and the next one retries (M1).
  const detail = await api.get<GitLabMRDetail>(`merge_requests/${mr.iid}`)
  const head = detail.sha ?? mr.sha ?? null
  const [approvers, threads, facts] = await Promise.all([
    readApprovers(api, mr.iid).catch((e: unknown) => warn(warnings, mr.iid, 'approvals', e)),
    head
      ? readWaitingThreads(ctx, api, mr.iid, mr.author.username, head).catch((e: unknown) =>
          warn(warnings, mr.iid, 'review threads', e)
        )
      : null,
    readBranchFacts(api, mr.source_branch)
  ])
  return {
    'mr.head_sha': head,
    'mr.head_short': short(head),
    'mr.changes_count': changesCount(detail.changes_count),
    'mr.pipeline': detail.head_pipeline?.id ?? null,
    'mr.pipeline_status': detail.head_pipeline?.status ?? null,
    'mr.approved_by': approvers === null ? null : approvers.join(','),
    'mr.approved_count': approvers === null ? null : approvers.length,
    'mr.waiting_threads': threads,
    ...gateFields(facts)
  }
}

async function toItem(
  ctx: SourceContext,
  api: GlabApi,
  mr: GitLabMR,
  where: MergeRequestWhere,
  people: PeopleDirectory,
  warnings: string[]
): Promise<Item> {
  const item = asItem(mr, listFields(mr))
  if (!mergeRequestListScope(item, where, people).ok) {
    return item
  }
  return asItem(mr, { ...item.fields, ...(await detailedFields(ctx, api, mr, warnings)) })
}

// merge_request items (contract §3): the open MRs of the repo's GitLab project, read through the
// pass's memoized client so automations sharing a pass ask GitLab once.
export function mergeRequestSource(): ItemSource {
  return {
    kind: 'merge_request',
    whereSchema: WHERE_SCHEMAS.merge_request,
    async list(ctx, rawWhere) {
      const where = mergeRequestWhereSchema.parse(rawWhere ?? {})
      const people = ctx.people ?? EMPTY_PEOPLE
      const api = await gitlabFor(ctx)
      const warnings: string[] = []
      const open = await listOpen(ctx, api, where, people, warnings)
      const items = await mapLimit(open, POOL, (mr) =>
        toItem(ctx, api, mr, where, people, warnings)
      )
      return { items, warnings }
    },
    scope(item, rawWhere, people) {
      return mergeRequestScope(item, mergeRequestWhereSchema.parse(rawWhere ?? {}), people)
    }
  }
}
