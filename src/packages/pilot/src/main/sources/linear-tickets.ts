import type { ItemFields } from '../../shared/api-types'
import type {
  LinearIssueListResult,
  LinearIssueSummary
} from '../../../../../shared/linear/agent-access'
import { WHERE_SCHEMAS, linearTicketWhereSchema } from '../../shared/definition/where'
import { EMPTY_PEOPLE } from '../../shared/people'
import {
  compareTickets,
  linearListFilter,
  linearTicketScope,
  stateTypeAllowed,
  ticketPriority
} from '../../shared/tick/scope-linear'
import { incompleteListing, type LinearConnector } from '../linear-connector/linear-connector'
import { mapLimit } from '../map-limit'
import { gateFields, readBranchFacts } from './branch-facts'
import type { GlabApi } from './gitlab-api'
import { gitlabFor } from './gitlab-fetch'
import type { Item, ItemSource, RepoFacts, SourceContext } from './types'
import type { GitRunner } from './worktree-git'
import type { WorktreeRecord } from './worktree-records'

export type LinearTicketSourceDeps = {
  linear: LinearConnector
  listWorktrees(repo: RepoFacts): Promise<WorktreeRecord[]>
  git: GitRunner
}

type Listed = LinearIssueListResult['issues'][number]
type Ticket = { listed: Listed; issue: LinearIssueSummary }

const POOL = 3
// A branch Pilot creates for the ticket (M01: from origin/dev) is mine: no ownership block.
const OWN_NEW_BRANCH: ItemFields = {
  'mr.owner_block': '',
  'mr.finished_block': '',
  'mr.review_block': '',
  'mr.draft_block': ''
}

// sweep.py find_worktree: the worktree linked to the ticket, else one on its branch.
export function findTicketWorktree(
  worktrees: readonly WorktreeRecord[],
  ident: string,
  branch: string | null
): WorktreeRecord | null {
  const linked = worktrees.find((w) => w.linkedLinearIssue === ident)
  if (linked) {
    return linked
  }
  return (branch && worktrees.find((w) => w.branch === branch)) || null
}

async function branchExists(git: GitRunner, repoPath: string, branch: string): Promise<boolean> {
  try {
    await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repoPath })
    return true
  } catch {
    return false
  }
}

async function readTickets(
  ctx: SourceContext,
  linear: LinearConnector,
  filter: 'assigned' | 'all',
  keep: (t: Listed) => boolean
): Promise<Ticket[]> {
  const listing = await ctx.fetch.memo(`linear:list:${filter}`, () => linear.listIssues(filter))
  const refusal = incompleteListing(listing)
  if (refusal) {
    throw new Error(refusal)
  }
  const kept = listing.issues.filter(keep)
  const tickets = await mapLimit(kept, POOL, async (t) => {
    const workspace = t.workspace.id || undefined
    const issue = await ctx.fetch.memo(`linear:issue:${t.workspace.id}:${t.identifier}`, () =>
      linear.issue(t.identifier, workspace)
    )
    return { listed: t, issue }
  })
  return tickets.sort((a, b) => compareTickets(a.issue, b.issue))
}

function ticketFields(t: Ticket, branch: string | null): ItemFields {
  const { issue } = t
  return {
    'ticket.id': issue.identifier,
    'ticket.uuid': issue.id,
    'ticket.title': issue.title,
    'ticket.url': issue.url,
    'ticket.branch': branch,
    'ticket.state': issue.state?.name ?? null,
    'ticket.state_type': issue.state?.type ?? null,
    'ticket.priority': issue.priority ?? null,
    'ticket.created_at': issue.createdAt ?? null,
    'ticket.team': issue.team?.key ?? null,
    'ticket.team_name': issue.team?.name ?? null,
    'ticket.assignee': issue.assignee?.displayName ?? null,
    'ticket.assignee_id': issue.assignee?.id ?? null,
    'ticket.workspace': t.listed.workspace.id || null
  }
}

async function ticketItem(
  ctx: SourceContext,
  deps: LinearTicketSourceDeps,
  api: GlabApi | null,
  t: Ticket,
  worktrees: readonly WorktreeRecord[]
): Promise<Item> {
  const branch = t.issue.branchName || null
  const wt = findTicketWorktree(worktrees, t.issue.identifier, branch)
  const fields: ItemFields = { ...ticketFields(t, branch) }
  if (wt) {
    Object.assign(fields, gateFields(await readBranchFacts(api, wt.branch)))
    fields['ticket.branch_exists'] = null
  } else {
    Object.assign(fields, OWN_NEW_BRANCH)
    fields['ticket.branch_exists'] = branch
      ? await branchExists(deps.git, ctx.repo.path, branch)
      : null
  }
  const created = Date.parse(t.issue.createdAt ?? '')
  return {
    kind: 'linear_ticket',
    key: `linear:${t.issue.identifier}`,
    label: t.issue.identifier,
    fields,
    worktreeHint: wt
      ? { id: wt.id, path: wt.path, branch: wt.branch, linearIssue: t.issue.identifier }
      : { linearIssue: t.issue.identifier },
    sortKeys: {
      priority: ticketPriority(t.issue.priority),
      waitingSince: Number.isNaN(created) ? null : created
    }
  }
}

export function linearTicketSource(deps: LinearTicketSourceDeps): ItemSource {
  return {
    kind: 'linear_ticket',
    whereSchema: WHERE_SCHEMAS.linear_ticket,
    async list(ctx, rawWhere) {
      const where = linearTicketWhereSchema.parse(rawWhere ?? {})
      // Like M01's unstarted(): only tickets of a wanted state get a details read.
      const tickets = await readTickets(ctx, deps.linear, linearListFilter(where), (t) =>
        stateTypeAllowed(t.state?.type, where)
      )
      const worktrees = (await deps.listWorktrees(ctx.repo)).filter((w) => !w.isArchived)
      const api = await gitlabFor(ctx).catch(() => null)
      const items = await mapLimit(tickets, POOL, (t) => ticketItem(ctx, deps, api, t, worktrees))
      return { items, warnings: [] }
    },
    scope(item, rawWhere, people) {
      const where = linearTicketWhereSchema.parse(rawWhere ?? {})
      return linearTicketScope(item.fields, where, people ?? EMPTY_PEOPLE)
    }
  }
}
