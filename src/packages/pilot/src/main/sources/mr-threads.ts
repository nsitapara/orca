import type { GlabApi } from './gitlab-api'
import { pageAll } from './gitlab-fetch'
import type { SourceContext } from './types'

export type GitLabNote = {
  system?: boolean
  author?: { username?: string } | null
  resolvable?: boolean
  resolved?: boolean
  created_at?: string
}
export type GitLabDiscussion = { notes?: GitLabNote[] }

// Port of mr-feedback-sweep/sweep.py waiting(): reviewer-started threads where the reviewer spoke
// last. System notes don't count; a thread whose first or last note is <author>'s is skipped; a
// resolvable thread counts while unresolved; a top-level note (never resolvable) counts when its last
// note is newer than the head commit ("posted after my last commit" stands in for "unaddressed").
export function waitingThreads(
  discussions: readonly GitLabDiscussion[],
  author: string,
  headCommittedAt: number
): number {
  let count = 0
  for (const d of discussions) {
    const notes = (d.notes ?? []).filter((n) => !n.system)
    const first = notes[0]
    const last = notes.at(-1)
    if (!first || !last) {
      continue
    }
    if (first.author?.username === author || last.author?.username === author) {
      continue
    }
    const waiting = first.resolvable
      ? !first.resolved
      : Date.parse(last.created_at ?? '') > headCommittedAt
    if (waiting) {
      count += 1
    }
  }
  return count
}

// sweep.py's reads: every page of the MR's discussions, and the head commit's committed_date.
export async function readWaitingThreads(
  ctx: SourceContext,
  api: GlabApi,
  iid: number,
  author: string,
  headSha: string
): Promise<number> {
  const [discussions, commit] = await Promise.all([
    pageAll<GitLabDiscussion>(ctx, api, `merge_requests/${iid}/discussions`),
    api.get<{ committed_date?: string }>(`repository/commits/${headSha}`)
  ])
  const at = Date.parse(commit.committed_date ?? '')
  if (Number.isNaN(at)) {
    throw new Error(`commit ${headSha.slice(0, 8)} has no committed date`)
  }
  return waitingThreads(discussions.items, author, at)
}
