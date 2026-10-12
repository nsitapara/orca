import type { ItemFields } from '../../shared/api-types'
import {
  branchOwner,
  draftBlock,
  finishedBlock,
  known,
  notKnown,
  ownerBlock,
  reviewBlock,
  type BranchMrFact,
  type Known
} from '../../shared/branch-rules'
import type { GlabApi } from './gitlab-api'
import { MAX_PAGES, MR_STATE, PER_PAGE, messageOf, readPages } from './gitlab-fetch'

// What GitLab may send; readBranchMrs checks what gate.branch_mrs indexes.
type GitLabBranchMr = {
  iid?: unknown
  state?: unknown
  author?: { username?: string } | null
  draft?: boolean
  target_branch?: string
  web_url?: unknown
}
type GitLabApprovals = { approved_by?: unknown }
type GitLabApproval = { user?: { username?: string } | null } | null

export type BranchMr = BranchMrFact & { targetBranch: string | null; webUrl: string }
export type BranchFacts = {
  mrs: Known<BranchMr[]>
  me: Known<string>
  approvals: ReadonlyMap<number, Known<string[]>>
}

const NO_API = 'no GitLab project for this repo'

async function attempt<T>(read: () => Promise<T>): Promise<Known<T>> {
  try {
    return known(await read())
  } catch (error) {
    return notKnown(messageOf(error))
  }
}

function branchMr(m: GitLabBranchMr, branch: string): BranchMr {
  if (typeof m.iid !== 'number' || typeof m.state !== 'string' || typeof m.web_url !== 'string') {
    throw new Error(`GitLab listed an MR from ${branch} without its iid, state or web URL`)
  }
  return {
    iid: m.iid,
    state: m.state,
    author: m.author?.username ?? null,
    draft: m.draft ?? false,
    targetBranch: m.target_branch ?? null,
    webUrl: m.web_url
  }
}

// gate.branch_mrs: every MR opened from <branch>, in any state (GitLab's default without `state`).
// What gate.py indexes (iid, state, web_url) must be there, and a listing cut short is unknown: both
// throw, so the rules block, as gate.py's KeyError does.
export async function readBranchMrs(api: GlabApi, branch: string): Promise<BranchMr[]> {
  const path = `merge_requests?source_branch=${encodeURIComponent(branch)}`
  const { items, capped } = await readPages<GitLabBranchMr>(api, path)
  if (capped) {
    throw new Error(`GitLab lists ${PER_PAGE * MAX_PAGES}+ MRs from ${branch}; not all were read`)
  }
  return items.map((m) => branchMr(m, branch))
}

// gate.me: the GitLab user glab is signed in as.
export async function readMe(api: GlabApi): Promise<string> {
  if (!api.getRoot) {
    throw new Error(`glab can't read user for ${api.projectPath}`)
  }
  const user = await api.getRoot<{ username?: string }>('user')
  if (!user.username) {
    throw new Error("GitLab didn't name the signed-in user")
  }
  return user.username
}

// gate.mr_approvers: who approved !<iid>, sorted. Only approved_by counts: GitLab's own `approved` is
// true with no approval at all in a project that requires none. gate.py reads .get("approved_by", [])
// and a["user"]["username"]: an approved_by that isn't a list, or an approval GitLab doesn't name, is
// an error, so it can't pass for "nobody approved".
export async function readApprovers(api: GlabApi, iid: number): Promise<string[]> {
  const answer = await api.get<GitLabApprovals>(`merge_requests/${iid}/approvals`)
  const found = answer.approved_by === undefined ? [] : answer.approved_by
  if (!Array.isArray(found)) {
    throw new Error(`GitLab didn't list !${iid}'s approvals`)
  }
  return found
    .map((a: GitLabApproval) => {
      const username = a?.user?.username
      if (!username) {
        throw new Error(`GitLab didn't name an approver of !${iid}`)
      }
      return username
    })
    .sort()
}

// Everything gate.py's ownership rules read about <branch>, each failure kept as its reason. Never
// throws: an unknown blocks through the rules ("MR owner unknown: …"), as gate.py does.
export async function readBranchFacts(api: GlabApi | null, branch: string): Promise<BranchFacts> {
  if (!api) {
    return { mrs: notKnown(NO_API), me: notKnown(NO_API), approvals: new Map() }
  }
  const [mrs, me] = await Promise.all([
    attempt(() => readBranchMrs(api, branch)),
    attempt(() => readMe(api))
  ])
  const approvals = new Map<number, Known<string[]>>()
  if (mrs.ok) {
    const open = mrs.value.filter((m) => m.state === 'opened')
    const reads = await Promise.all(open.map((m) => attempt(() => readApprovers(api, m.iid))))
    for (let i = 0; i < open.length; i++) {
      approvals.set(open[i].iid, reads[i])
    }
  }
  return { mrs, me, approvals }
}

// '' = no block (the check passes); any other text is gate.py's reason the check fails with.
export function gateFields(facts: BranchFacts): ItemFields {
  const approvers = (iid: number): Known<string[]> =>
    facts.approvals.get(iid) ?? notKnown('approvals were not read')
  return {
    'mr.owner_block': ownerBlock(facts.mrs, facts.me) ?? '',
    'mr.finished_block': finishedBlock(facts.mrs) ?? '',
    'mr.review_block': reviewBlock(facts.mrs, facts.me, approvers) ?? '',
    'mr.draft_block': draftBlock(facts.mrs) ?? ''
  }
}

const NO_MR: ItemFields = {
  'mr.iid': null,
  'mr.state': null,
  'mr.author': null,
  'mr.draft': null,
  'mr.target_branch': null,
  'mr.web_url': null,
  'mr.approved_by': null,
  'mr.approved_count': null
}

function approvedFields(owner: BranchMr, approvals: Known<string[]> | undefined): ItemFields {
  if (owner.state !== 'opened') {
    return { 'mr.approved_by': '', 'mr.approved_count': 0 }
  }
  if (!approvals?.ok) {
    return { 'mr.approved_by': null, 'mr.approved_count': null }
  }
  return {
    'mr.approved_by': approvals.value.join(','),
    'mr.approved_count': approvals.value.length
  }
}

// The MR that says whose the branch is (gate.branch_owner), for items that aren't MRs themselves.
// Without my username it ranks as if none were mine, and says why on mr.lookup_error.
export function linkFields(facts: BranchFacts): ItemFields {
  if (!facts.mrs.ok) {
    return { ...NO_MR, 'mr.lookup_error': facts.mrs.error }
  }
  const owner = branchOwner(facts.mrs.value, facts.me.ok ? facts.me.value : '')
  if (!owner) {
    return { ...NO_MR, 'mr.lookup_error': null }
  }
  return {
    'mr.iid': owner.iid,
    'mr.state': MR_STATE[owner.state] ?? owner.state,
    'mr.author': owner.author,
    'mr.draft': owner.draft,
    'mr.target_branch': owner.targetBranch,
    'mr.web_url': owner.webUrl,
    ...approvedFields(owner, facts.approvals.get(owner.iid)),
    'mr.lookup_error': facts.me.ok ? null : facts.me.error
  }
}
