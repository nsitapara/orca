import type { ItemFields } from '../../shared/api-types'
import type { MergeRequestWhere } from '../../shared/definition/types'
import { mergeRequestWhereSchema } from '../../shared/definition/where'
import { EMPTY_PEOPLE, gitlabHandlesFor } from '../../shared/people'
import { authorScope, mergeRequestScope } from '../../shared/tick/scope'
import type { GlabApi } from './gitlab-api'
import type { Item, ItemSource } from './types'

type GitLabMR = {
  iid: number
  title: string
  source_branch: string
  author: { username: string }
  state: string
  draft?: boolean
}
type GitLabMRDetail = GitLabMR & { head_pipeline: { id: number; status: string } | null }

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

function mrFields(mr: GitLabMR, detail: GitLabMRDetail | null): ItemFields {
  return {
    'mr.iid': mr.iid,
    'mr.title': mr.title,
    'mr.branch': mr.source_branch,
    'mr.author': mr.author.username,
    'mr.state': STATE[mr.state] ?? mr.state,
    'mr.draft': mr.draft ?? false,
    'mr.pipeline': detail?.head_pipeline?.id ?? null,
    'mr.pipeline_status': detail?.head_pipeline?.status ?? null
  }
}

const PER_PAGE = 100
const MAX_PAGES = 10

// null authorUsernames = no author filter; [] = nobody resolvable (no request is made).
export type MergeRequestScope = {
  authorUsernames: string[] | null
  inScope: (username: string) => boolean
}

async function listForAuthor(api: GlabApi, username: string): Promise<GitLabMR[]> {
  const author = encodeURIComponent(username)
  const list = await api.get<GitLabMR[]>(
    `merge_requests?state=opened&author_username=${author}&per_page=${PER_PAGE}`
  )
  if (list.length >= PER_PAGE) {
    console.warn(
      `[pilot] ${api.projectPath}: ${username} has ${PER_PAGE}+ open MRs; the list may be truncated`
    )
  }
  return list
}

async function listAllPages(api: GlabApi): Promise<GitLabMR[]> {
  const all: GitLabMR[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await api.get<GitLabMR[]>(
      `merge_requests?state=opened&per_page=${PER_PAGE}&page=${page}`
    )
    all.push(...batch)
    if (batch.length < PER_PAGE) {
      return all
    }
  }
  console.warn(
    `[pilot] ${api.projectPath}: stopped at ${MAX_PAGES * PER_PAGE} open MRs; later ones are not checked`
  )
  return all
}

async function listOpen(api: GlabApi, authors: string[] | null): Promise<GitLabMR[]> {
  if (authors === null) {
    return listAllPages(api)
  }
  const byIid = new Map<number, GitLabMR>()
  for (const username of authors) {
    for (const mr of await listForAuthor(api, username)) {
      byIid.set(mr.iid, mr)
    }
  }
  return [...byIid.values()]
}

// The list endpoint omits head_pipeline, so each in-scope MR is fetched on its own (as ci-fix-sweep
// does today). GitLab is asked only for the authors the automation is about; inScope stays as a
// second guard. Fetched values may be shared through the pass cache: filter and map, never mutate.
export async function listMergeRequestItems(
  api: GlabApi,
  scope: MergeRequestScope
): Promise<Item[]> {
  const list = (await listOpen(api, scope.authorUsernames)).filter((mr) =>
    scope.inScope(mr.author.username)
  )
  const items: Item[] = []
  for (const mr of list.sort((a, b) => a.iid - b.iid)) {
    const detail = await api.get<GitLabMRDetail>(`merge_requests/${mr.iid}`)
    items.push({
      kind: 'merge_request',
      key: `!${mr.iid}`,
      label: `!${mr.iid} ${shortBranch(mr.source_branch)}`,
      fields: mrFields(mr, detail),
      worktreeHint: { branch: mr.source_branch },
      sortKeys: { waitingSince: null, priority: null }
    })
  }
  return items
}

// merge_request items (contract §3): the open MRs of the repo's GitLab project, read through the
// pass's fetch cache so automations sharing a pass ask GitLab once.
export const mergeRequestSource: ItemSource = {
  kind: 'merge_request',
  whereSchema: mergeRequestWhereSchema,
  async list(ctx, where) {
    const w = where as MergeRequestWhere
    const people = ctx.people ?? EMPTY_PEOPLE
    const api = await ctx.fetch.gitlab(ctx.repo.path)
    const items = await listMergeRequestItems(api, {
      authorUsernames: gitlabHandlesFor(w.author, people),
      inScope: (username) => authorScope(w.author, username, people).ok
    })
    return { items, warnings: [] }
  },
  scope: (item, where, people) => mergeRequestScope(item, where as MergeRequestWhere, people)
}
