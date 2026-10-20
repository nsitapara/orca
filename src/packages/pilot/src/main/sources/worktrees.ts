import type { ItemFields } from '../../shared/api-types'
import { EMPTY_PEOPLE } from '../../shared/people'
import type { WorktreeWhere } from '../../shared/definition/types'
import { WHERE_SCHEMAS, worktreeWhereSchema } from '../../shared/definition/where'
import { numberOf, textOf } from '../../shared/tick/scope-helpers'
import { firstSightBaseline, firstSightMode, worktreeScope } from '../../shared/tick/scope-worktree'
import { mapLimit } from '../map-limit'
import { gateFields, linkFields, readBranchFacts } from './branch-facts'
import type { GlabApi } from './gitlab-api'
import { gitlabFor, messageOf } from './gitlab-fetch'
import type { Item, ItemSource, RepoFacts, SourceContext } from './types'
import { commitFacts, type CommitFacts, type GitRunner } from './worktree-git'
import { eligibleWorktree, type WorktreeRecord } from './worktree-records'

export type WorktreeSourceDeps = {
  listWorktrees(repo: RepoFacts): Promise<WorktreeRecord[]>
  git: GitRunner
  markers(automationId: string): ReadonlyMap<string, string>
  pathExists(path: string): boolean
  // A folder one of Pilot's own throwaways works in (store.runs.envs.isThrowawayFolder): never Nish's work.
  envFolder?(path: string): boolean
}

const POOL = 3

function commitFields(id: string, c: CommitFacts): ItemFields {
  return {
    'worktree.head': c.head,
    'worktree.head_short': c.head.slice(0, 9),
    'worktree.at_head': `${id}@${c.head}`,
    'worktree.rewritten': c.rewritten,
    'worktree.first_sight': c.firstSight,
    'worktree.base_ref': c.baseRef,
    'worktree.since': c.since,
    'worktree.since_short': c.since.slice(0, 9),
    'worktree.new_commits': c.commits.length,
    'worktree.waiting_since': c.commits.at(-1)?.at ?? null,
    'worktree.newest_commit_at': c.commits[0]?.at ?? null,
    'worktree.git_error': null
  }
}

function unreadCommits(w: WorktreeRecord, error: string): ItemFields {
  const head = w.head || null
  return {
    'worktree.head': head,
    'worktree.head_short': head ? head.slice(0, 9) : null,
    'worktree.at_head': head ? `${w.id}@${head}` : null,
    'worktree.rewritten': null,
    'worktree.first_sight': null,
    'worktree.base_ref': null,
    'worktree.since': null,
    'worktree.since_short': null,
    'worktree.new_commits': null,
    'worktree.waiting_since': null,
    'worktree.newest_commit_at': null,
    'worktree.git_error': error
  }
}

async function readCommits(
  deps: WorktreeSourceDeps,
  w: WorktreeRecord,
  where: WorktreeWhere,
  marker: string | null,
  mrTarget: string | null,
  warnings: string[]
): Promise<ItemFields> {
  // No ignore_trailer: any agent loop's commit is ignored (04's rule, R-6).
  const ignoreTrailer = where.commits?.ignore_trailer ?? null
  try {
    const facts = await commitFacts(
      deps.git,
      w.path,
      w.branch,
      marker,
      ignoreTrailer,
      firstSightMode(where.commits),
      mrTarget,
      where.commits?.paths
    )
    return commitFields(w.id, facts)
  } catch (error) {
    warnings.push(`${w.branch}: couldn't read its commits: ${messageOf(error)}`)
    return unreadCommits(w, messageOf(error))
  }
}

async function worktreeItem(
  ctx: SourceContext,
  deps: WorktreeSourceDeps,
  api: GlabApi | null,
  w: WorktreeRecord,
  where: WorktreeWhere,
  markers: ReadonlyMap<string, string>,
  warnings: string[]
): Promise<Item> {
  const facts = await readBranchFacts(api, w.branch)
  const link = linkFields(facts)
  // due.mr_target: only an open MR's target counts as the base.
  const mrTarget = link['mr.state'] === 'open' ? textOf(link['mr.target_branch']) : null
  const marker = markers.get(w.id) ?? null
  const commits = await readCommits(deps, w, where, marker, mrTarget, warnings)
  const fields: ItemFields = {
    'worktree.id': w.id,
    'worktree.path': w.path,
    'worktree.branch': w.branch,
    'worktree.linear_issue': w.linkedLinearIssue,
    'worktree.marker': marker,
    ...commits,
    ...link,
    ...gateFields(facts)
  }
  if (where.commits) {
    fields['item.baseline'] = firstSightBaseline(
      where.commits,
      {
        firstSight: commits['worktree.first_sight'] === true,
        newCommits: numberOf(commits['worktree.new_commits']) ?? 0,
        newestCommitAt: numberOf(commits['worktree.newest_commit_at'])
      },
      ctx.now
    )
  }
  return {
    kind: 'worktree',
    key: `wt:${w.id}`,
    label: w.branch,
    fields,
    worktreeHint: { id: w.id, path: w.path, branch: w.branch },
    sortKeys: { waitingSince: numberOf(fields['worktree.waiting_since']), priority: null }
  }
}

export function worktreeSource(deps: WorktreeSourceDeps): ItemSource {
  return {
    kind: 'worktree',
    whereSchema: WHERE_SCHEMAS.worktree,
    async list(ctx, rawWhere) {
      const where = worktreeWhereSchema.parse(rawWhere ?? {})
      const warnings: string[] = []
      const records = (await deps.listWorktrees(ctx.repo)).filter(
        (w) => eligibleWorktree(w, deps.pathExists) && !deps.envFolder?.(w.path)
      )
      // Without GitLab every ownership fact is unknown, so the gate rules block (fail closed).
      const api = await gitlabFor(ctx).catch((error: unknown) => {
        warnings.push(`No GitLab project for ${ctx.repo.name}: ${messageOf(error)}`)
        return null
      })
      const markers = deps.markers(ctx.automationId)
      const items = await mapLimit(records, POOL, (w) =>
        worktreeItem(ctx, deps, api, w, where, markers, warnings)
      )
      return { items, warnings }
    },
    scope(item, rawWhere, people) {
      const where = worktreeWhereSchema.parse(rawWhere ?? {})
      return worktreeScope(item.fields, where, people ?? EMPTY_PEOPLE)
    }
  }
}
