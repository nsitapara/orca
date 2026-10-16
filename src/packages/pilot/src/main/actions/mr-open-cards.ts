import type { InboxItemRow } from '../../shared/api-types'
import { jobCode } from '../../shared/job-name'
import { worktreePathKey } from '../fields/agent-activity'
import { WAITING } from '../inbox/inbox-service'
import { branchOfRun, fieldsForRun } from '../inbox/run-fields'
import type { PilotStore } from '../store/store'
import { branchWorktrees, namesMr, type StoreDeps } from './mr-branch'
import type { ActionCaller } from './types'

// mark-ready.py's BLOCKING_JOBS: their open cards mean the branch still has work in it.
const BLOCKING_JOBS: ReadonlySet<string> = new Set(['03', '04', '05', '06'])

// Whether a card is on MR !iid's branch, as mark-ready.py's items were (by branch, so a 03 card made before the MR
// existed counts): about the MR (mr:<iid>), on one of the branch's worktrees (paths: what the newest 03/04 tick says,
// which covers cards whose run has no tick fields), its run's item naming the MR or the branch, or, outside a run, an
// item key under the branch.
function onBranch(
  store: PilotStore,
  card: InboxItemRow,
  mr: { iid: number; branch: string; paths: ReadonlySet<string> }
): boolean {
  if (card.itemKey === `mr:${mr.iid}`) {
    return true
  }
  if (card.worktreePath && mr.paths.has(worktreePathKey(card.worktreePath))) {
    return true
  }
  if (!card.runId) {
    return (card.itemKey ?? '').startsWith(`${mr.branch}:`)
  }
  return (
    namesMr(fieldsForRun(store, card.runId), mr.iid) || branchOfRun(store, card.runId) === mr.branch
  )
}

// The waiting cards from jobs 03–06 on MR !iid's branch (mark-ready.py's open items: not a folded default, not done),
// less the card being approved, as mark-ready.py's blocker: "<n> open item(s) from 03, 06". Null when there are none.
export function openCardsOn(
  deps: StoreDeps,
  iid: number,
  branch: string,
  caller: ActionCaller
): string | null {
  const codes = new Map(deps.definitions().map((d) => [d.id, jobCode(d.name)]))
  const paths = new Set(branchWorktrees(deps, branch).map(worktreePathKey))
  const open = deps.store.inbox
    .list({ status: WAITING })
    .filter(
      (card) =>
        card.id !== caller.inboxItemId &&
        card.type !== 'default' &&
        BLOCKING_JOBS.has(codes.get(card.automationId) ?? '') &&
        onBranch(deps.store, card, { iid, branch, paths })
    )
  if (open.length === 0) {
    return null
  }
  const jobs = [...new Set(open.map((card) => codes.get(card.automationId)))].sort().join(', ')
  return `${open.length} open item${open.length === 1 ? '' : 's'} from ${jobs}`
}
