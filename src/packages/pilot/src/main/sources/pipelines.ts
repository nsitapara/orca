import type { ItemFields } from '../../shared/api-types'
import type { PipelineWhere } from '../../shared/definition/types'
import { WHERE_SCHEMAS, pipelineWhereSchema } from '../../shared/definition/where'
import { pipelineScope } from '../../shared/tick/scope-pipeline'
import type { GlabApi } from './gitlab-api'
import { gitlabFor } from './gitlab-fetch'
import type { Item, ItemSource } from './types'

export type GitLabPipeline = {
  id: number
  status: string
  ref?: string
  sha: string
  web_url: string
  created_at?: string
}
export type GitLabJob = {
  id: number
  name: string
  status: string
  allow_failure?: boolean
  web_url?: string
}
type Latest = { pipeline: GitLabPipeline; jobs: GitLabJob[] }

// sweep.py CHILDREN: the newest children scanned (the gate's no-op children sit between real runs).
export const CHILDREN_SCANNED = 30
const JOBS_PER_PAGE = 100
const FINISHED = new Set(['success', 'failed'])

// A pipeline that ran the suite has a marker job; without markers every finished pipeline counts.
export function ranSuite(jobs: readonly GitLabJob[], markers: ReadonlySet<string> | null): boolean {
  return markers === null || jobs.some((j) => markers.has(j.name))
}

// sweep.py real_failures: failed, not allow_failure, and not a marker (notify) job.
export function realFailures(
  jobs: readonly GitLabJob[],
  markers: ReadonlySet<string> | null
): GitLabJob[] {
  return jobs.filter(
    (j) => j.status === 'failed' && !j.allow_failure && !(markers?.has(j.name) ?? false)
  )
}

// sweep.py latest_and_green: the newest finished pipeline that ran the suite, and (only when it is red)
// the newest one before it that ran the suite green. Newest first in.
export async function latestAndGreen(
  pipelines: readonly GitLabPipeline[],
  jobsOf: (id: number) => Promise<GitLabJob[]>,
  markers: ReadonlySet<string> | null
): Promise<{ latest: Latest | null; green: GitLabPipeline | null }> {
  let latest: Latest | null = null
  for (const pipeline of pipelines) {
    if (!FINISHED.has(pipeline.status)) {
      continue
    }
    const jobs = await jobsOf(pipeline.id)
    if (!ranSuite(jobs, markers)) {
      continue
    }
    const red = realFailures(jobs, markers).length > 0
    if (latest === null) {
      latest = { pipeline, jobs }
      if (!red) {
        return { latest, green: null }
      }
    } else if (!red) {
      return { latest, green: pipeline }
    }
  }
  return { latest, green: null }
}

function listPath(where: PipelineWhere): string {
  const query = new URLSearchParams({
    ...(where.source ? { source: where.source } : {}),
    ref: where.ref,
    order_by: 'id',
    sort: 'desc',
    per_page: String(CHILDREN_SCANNED)
  })
  return `pipelines?${query.toString()}`
}

function pipelineItem(
  found: Latest,
  green: GitLabPipeline | null,
  markers: ReadonlySet<string> | null
): Item {
  const { pipeline } = found
  const failed = realFailures(found.jobs, markers)
  const names = [...new Set(failed.map((j) => j.name))].sort()
  const fields: ItemFields = {
    'pipeline.id': pipeline.id,
    'pipeline.status': pipeline.status,
    'pipeline.ref': pipeline.ref ?? null,
    'pipeline.sha': pipeline.sha,
    'pipeline.short_sha': pipeline.sha.slice(0, 9),
    'pipeline.web_url': pipeline.web_url,
    'pipeline.created_at': pipeline.created_at ?? null,
    'pipeline.ran_suite': markers === null ? null : true,
    'pipeline.failed_jobs': names.join(','),
    'pipeline.failed_count': names.length,
    'pipeline.failed_jobs_json': JSON.stringify(
      failed.map((j) => ({ id: j.id, name: j.name, web_url: j.web_url ?? null }))
    ),
    'pipeline.green_id': green?.id ?? null,
    'pipeline.green_sha': green?.sha ?? null,
    'pipeline.green_url': green?.web_url ?? null
  }
  const created = Date.parse(pipeline.created_at ?? '')
  return {
    kind: 'pipeline',
    key: `pipeline:${pipeline.id}`,
    label: `pipeline ${pipeline.id}`,
    fields,
    worktreeHint: null,
    sortKeys: { waitingSince: Number.isNaN(created) ? null : created, priority: null }
  }
}

// A job list that is malformed, or as long as the page cap (it may have been cut short), could hide a
// real failure: the tick fails rather than call the pipeline green.
async function jobsOf(api: GlabApi, id: number): Promise<GitLabJob[]> {
  const jobs = await api.get<GitLabJob[]>(`pipelines/${id}/jobs?per_page=${JOBS_PER_PAGE}`)
  if (!Array.isArray(jobs)) {
    throw new Error(`GitLab did not answer pipeline ${id}'s jobs with a list`)
  }
  if (jobs.length >= JOBS_PER_PAGE) {
    throw new Error(`Pipeline ${id}'s job list may be cut short (${jobs.length} jobs)`)
  }
  return jobs
}

export function pipelineSource(): ItemSource {
  return {
    kind: 'pipeline',
    whereSchema: WHERE_SCHEMAS.pipeline,
    async list(ctx, rawWhere) {
      const where = pipelineWhereSchema.parse(rawWhere)
      const api = await gitlabFor(ctx)
      const pipelines = await api.get<GitLabPipeline[]>(listPath(where))
      if (!Array.isArray(pipelines)) {
        throw new Error('GitLab did not answer the pipeline list with a list')
      }
      const markers = where.select === 'newest_suite_running' ? new Set(where.marker_jobs) : null
      const found = await latestAndGreen(pipelines, (id) => jobsOf(api, id), markers)
      if (!found.latest) {
        return { items: [], warnings: [] }
      }
      return { items: [pipelineItem(found.latest, found.green, markers)], warnings: [] }
    },
    scope(item, rawWhere) {
      return pipelineScope(item.fields, pipelineWhereSchema.parse(rawWhere))
    }
  }
}
