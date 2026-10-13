import { gitOptionalLocksDisabledEnv } from '../../../../../main/git/command-runner/git-process-env'
import type { ItemFields } from '../../shared/api-types'
import type { LinearTicketWhere } from '../../shared/definition/types'
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
import { gitlabFor, messageOf } from './gitlab-fetch'
import type { Item, ItemSource, RepoFacts, SourceContext } from './types'
import type { GitRunner } from './worktree-git'
import type { WorktreeRecord } from './worktree-records'

export type LinearTicketSourceDeps = {
  linear: LinearConnector
  listWorktrees(repo: RepoFacts): Promise<WorktreeRecord[]>
  git: GitRunner
}

type Listed = LinearIssueListResult['issues'][number]
// workspace: the listing's workspace id; null for a ticket read by identifier (where.ids_from).
type Ticket = { workspace: string | null; issue: LinearIssueSummary }

const POOL = 3
const LINEAR_IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*-\d+$/
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

// sweep.py branch_exists: only git's own "no such ref" (exit 1) means absent. Any other failure
// (timeout, spawn error, not a repo) is unknown and throws, so the item is blocked, never "mine".
async function branchExists(git: GitRunner, repoPath: string, branch: string): Promise<boolean> {
  try {
    await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
      cwd: repoPath,
      env: gitOptionalLocksDisabledEnv()
    })
    return true
  } catch (error) {
    const { code, killed, signal } = (error ?? {}) as {
      code?: unknown
      killed?: unknown
      signal?: unknown
    }
    if (code === 1 && !killed && !signal) {
      return false
    }
    throw error
  }
}

// M01 runs no ownership check for a ticket without a worktree (a new branch off origin/dev is mine),
// but a branch whose existence can't be read blocks, as an unknown does everywhere.
async function lonelyBranchFields(
  git: GitRunner,
  repoPath: string,
  branch: string | null
): Promise<ItemFields> {
  if (!branch) {
    return { ...OWN_NEW_BRANCH, 'ticket.branch_exists': null }
  }
  try {
    return { ...OWN_NEW_BRANCH, 'ticket.branch_exists': await branchExists(git, repoPath, branch) }
  } catch (error) {
    const reason = `branch ${branch} unknown: ${messageOf(error)}`
    return {
      'mr.owner_block': reason,
      'mr.finished_block': reason,
      'mr.review_block': reason,
      'mr.draft_block': reason,
      'ticket.branch_exists': null
    }
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
    return { workspace: t.workspace.id || null, issue }
  })
  return tickets.sort((a, b) => compareTickets(a.issue, b.issue))
}

function notFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'linear_issue_not_found'
  )
}

// where.ids_from: each id read by identifier (Linear resolves it across the signed-in workspaces), no listing. A
// ticket Linear doesn't know is skipped with a warning; any other failed read fails the tick, as a listing's does.
// Like the listing, only a ticket in a wanted state is kept.
async function readTicketsByIds(
  ctx: SourceContext,
  linear: LinearConnector,
  ids: readonly string[],
  where: LinearTicketWhere,
  warnings: string[]
): Promise<Ticket[]> {
  const bad = ids.find((id) => !LINEAR_IDENTIFIER.test(id))
  if (bad !== undefined) {
    throw new Error(`ids_from gave "${bad}", which isn't a Linear identifier (like WEB-123)`)
  }
  const read = await mapLimit([...ids], POOL, async (id) => {
    try {
      return await ctx.fetch.memo(`linear:issue::${id}`, () => linear.issue(id))
    } catch (error) {
      if (notFound(error)) {
        warnings.push(`${id}: Linear has no such ticket; it isn't checked`)
        return null
      }
      throw error
    }
  })
  return read
    .filter((issue): issue is LinearIssueSummary => issue !== null)
    .filter((issue) => stateTypeAllowed(issue.state?.type, where))
    .map((issue) => ({ workspace: null, issue }))
    .sort((a, b) => compareTickets(a.issue, b.issue))
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
    'ticket.workspace': t.workspace
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
    Object.assign(fields, await lonelyBranchFields(deps.git, ctx.repo.path, branch))
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
      const warnings: string[] = []
      // Like M01's unstarted(): only tickets of a wanted state get a details read.
      const tickets = ctx.ids
        ? await readTicketsByIds(ctx, deps.linear, ctx.ids, where, warnings)
        : await readTickets(ctx, deps.linear, linearListFilter(where), (t) =>
            stateTypeAllowed(t.state?.type, where)
          )
      const worktrees = (await deps.listWorktrees(ctx.repo)).filter((w) => !w.isArchived)
      // Without GitLab every ownership fact is unknown, so the gate rules block (fail closed).
      const api = await gitlabFor(ctx).catch((error: unknown) => {
        warnings.push(`No GitLab project for ${ctx.repo.name}: ${messageOf(error)}`)
        return null
      })
      const items = await mapLimit(tickets, POOL, (t) => ticketItem(ctx, deps, api, t, worktrees))
      return { items, warnings }
    },
    scope(item, rawWhere, people) {
      const where = linearTicketWhereSchema.parse(rawWhere ?? {})
      return linearTicketScope(item.fields, where, people ?? EMPTY_PEOPLE)
    }
  }
}
