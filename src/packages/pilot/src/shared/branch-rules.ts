// Ports of worktree-gate/gate.py's ownership rules (references/ownership.md): owner_block, mr_finished,
// mr_block, review_block, and a draft rule beside them. Inputs are what GitLab said, or why it couldn't
// say; an unknown always blocks, with gate.py's words.
export type Known<T> = { ok: true; value: T } | { ok: false; error: string }
export type BranchMrFact = { iid: number; state: string; author: string | null; draft: boolean }

export function known<T>(value: T): Known<T> {
  return { ok: true, value }
}

export function notKnown<T>(error: string): Known<T> {
  return { ok: false, error }
}

function isMine(mr: BranchMrFact, me: string): boolean {
  return Boolean(mr.author) && mr.author === me
}

function rank(mr: BranchMrFact, me: string): number[] {
  return [mr.state === 'opened' ? 0 : 1, isMine(mr, me) ? 0 : 1, -mr.iid]
}

function compareRanks(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i]
    }
  }
  return 0
}

// gate._owner: the MR that says whose a branch is: its open MR; with none open, one I opened; else
// its newest. So a teammate's open MR makes the branch theirs even when I opened an earlier one.
export function branchOwner<M extends BranchMrFact>(mrs: readonly M[], me: string): M | null {
  const sorted = [...mrs].sort((a, b) => compareRanks(rank(a, me), rank(b, me)))
  return sorted[0] ?? null
}

// gate.owner_block: "!1588 is shivan2418's MR", or "MR owner unknown: …"; null for mine or no MR yet.
export function ownerBlock(mrs: Known<BranchMrFact[]>, me: Known<string>): string | null {
  if (!mrs.ok) {
    return `MR owner unknown: ${mrs.error}`
  }
  if (!me.ok) {
    return `MR owner unknown: ${me.error}`
  }
  const found = branchOwner(mrs.value, me.value)
  if (!found) {
    return null
  }
  if (!found.author) {
    return `MR owner unknown: GitLab didn't name !${found.iid}'s author`
  }
  return found.author === me.value ? null : `!${found.iid} is ${found.author}'s MR`
}

const FINISHED = new Set(['merged', 'closed'])

// gate.mr_finished: "!1453 merged" when none of the branch's MRs is open and the newest is finished.
export function mrFinished(mrs: readonly BranchMrFact[]): string | null {
  if (mrs.length === 0 || mrs.some((m) => m.state === 'opened')) {
    return null
  }
  let newest = mrs[0]
  for (const m of mrs) {
    if (m.iid > newest.iid) {
      newest = m
    }
  }
  return FINISHED.has(newest.state) ? `!${newest.iid} ${newest.state}` : null
}

// gate.mr_block.
export function finishedBlock(mrs: Known<BranchMrFact[]>): string | null {
  return mrs.ok ? mrFinished(mrs.value) : `MR state unknown: ${mrs.error}`
}

// gate.review_block: mr_block's or owner_block's reason, else "!1577 approved by a, b" once an open MR
// has an approval (approvals survive later pushes, so it holds until revoked).
export function reviewBlock(
  mrs: Known<BranchMrFact[]>,
  me: Known<string>,
  approvers: (iid: number) => Known<string[]>
): string | null {
  const block = finishedBlock(mrs) ?? ownerBlock(mrs, me)
  if (block || !mrs.ok) {
    return block
  }
  for (const mr of mrs.value) {
    if (mr.state !== 'opened') {
      continue
    }
    const found = approvers(mr.iid)
    if (!found.ok) {
      return `MR approval unknown: ${found.error}`
    }
    if (found.value.length > 0) {
      return `!${mr.iid} approved by ${found.value.join(', ')}`
    }
  }
  return null
}

// Not in gate.py: "!1590 is a draft" while one of the branch's open MRs is a draft (the `mr: not_draft` check).
export function draftBlock(mrs: Known<BranchMrFact[]>): string | null {
  if (!mrs.ok) {
    return `MR draft state unknown: ${mrs.error}`
  }
  const draft = mrs.value
    .filter((m) => m.state === 'opened' && m.draft)
    .sort((a, b) => b.iid - a.iid)[0]
  return draft ? `!${draft.iid} is a draft` : null
}
