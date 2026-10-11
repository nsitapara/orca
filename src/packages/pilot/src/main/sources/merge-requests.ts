import type { ItemFields, TickItem } from '../../shared/api-types'
import type { GlabApi } from './gitlab-api'

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

// The list endpoint omits head_pipeline, so each in-scope MR is fetched on its own (as ci-fix-sweep does today).
// per_page=100 keeps one request from stopping at GitLab's default 20; beyond 100 open MRs is not paged.
export async function listMergeRequestItems(
  api: GlabApi,
  inScope: (username: string) => boolean
): Promise<TickItem[]> {
  const list = await api.get<GitLabMR[]>('merge_requests?state=opened&per_page=100')
  const items: TickItem[] = []
  for (const mr of [...list].sort((a, b) => a.iid - b.iid)) {
    const detail = inScope(mr.author.username)
      ? await api.get<GitLabMRDetail>(`merge_requests/${mr.iid}`)
      : null
    items.push({
      key: `!${mr.iid}`,
      label: `!${mr.iid} ${shortBranch(mr.source_branch)}`,
      fields: mrFields(mr, detail)
    })
  }
  return items
}
