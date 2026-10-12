import { mrFinished, type BranchMrFact } from '../../shared/branch-rules'
import type { GlabApi } from '../sources/gitlab-api'

export type MrTarget = { iid: number } | { branch: string }
// finished: "!1561 merged" or null while an MR is open; unknown: GitLab couldn't say.
export type MrBlock = { finished: string | null } | { unknown: string }
const BRANCH_PAGE = 20
type MrState = { iid: number; state: string }

// Task 14a's rule (gate.py mr_finished) only reads iid and state; the other facts don't matter here.
function finishedOf(mrs: MrState[]): string | null {
  return mrFinished(
    mrs.map((m): BranchMrFact => ({ iid: m.iid, state: m.state, author: null, draft: false }))
  )
}

// Fail closed: a body that isn't an MR with an iid and a state is an unknown, never "not finished".
function validMrs(bodies: unknown[]): MrState[] {
  return bodies.map((b) => {
    const mr = b as Partial<MrState> | null
    if (!mr || typeof mr.iid !== 'number' || typeof mr.state !== 'string') {
      throw new Error('unexpected GitLab answer')
    }
    return { iid: mr.iid, state: mr.state }
  })
}

export function targetKey(target: MrTarget): string {
  return 'iid' in target ? `iid:${target.iid}` : `branch:${target.branch}`
}

// GET only. A card about one MR reads that MR; a card about a worktree reads every MR of its branch.
export async function mrBlock(api: GlabApi, target: MrTarget): Promise<MrBlock> {
  try {
    if ('iid' in target) {
      return {
        finished: finishedOf(validMrs([await api.get<unknown>(`merge_requests/${target.iid}`)]))
      }
    }
    const branch = encodeURIComponent(target.branch)
    const body = await api.get<unknown>(
      `merge_requests?source_branch=${branch}&state=all&per_page=${BRANCH_PAGE}`
    )
    if (!Array.isArray(body)) {
      throw new Error('unexpected GitLab answer')
    }
    // A full page may have cut off a newer MR: the state of the branch isn't known.
    if (body.length >= BRANCH_PAGE) {
      throw new Error(`the branch has ${BRANCH_PAGE} or more merge requests`)
    }
    return { finished: finishedOf(validMrs(body)) }
  } catch (error) {
    return {
      unknown: `MR state unknown: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
