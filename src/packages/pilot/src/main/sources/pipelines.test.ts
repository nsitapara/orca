import { describe, expect, it } from 'vitest'
import { fakeGlab, sourceContext } from './__fixtures__/source-context'
import {
  latestAndGreen,
  pipelineSource,
  realFailures,
  type GitLabJob,
  type GitLabPipeline
} from './pipelines'

const MARKERS = new Set(['notify-slack', 'notify-slack-recovery'])
let nextJob = 1
const job = (name: string, status = 'success', allowFailure = false): GitLabJob => ({
  id: nextJob++,
  name,
  status,
  allow_failure: allowFailure,
  web_url: `https://gitlab.com/j/${name}`
})
const child = (id: number, status: string): GitLabPipeline => ({
  id,
  status,
  ref: 'dev',
  sha: `${id}`.repeat(12),
  web_url: `https://gitlab.com/p/${id}`,
  created_at: `2026-10-11T0${id}:05:00Z`
})

const SUITE_OK = [job('e2e-checks-and-build'), job('notify-slack-recovery', 'skipped')]
const SUITE_RED = [
  job('e2e-checks-and-build', 'failed'),
  job('test-apps-smoke-test', 'failed', true),
  job('notify-slack')
]
const NO_OP = [job('e2e-skipped')]
const JOBS: Record<number, GitLabJob[]> = {
  5: SUITE_OK,
  4: SUITE_RED,
  3: NO_OP,
  2: SUITE_RED,
  1: SUITE_OK
}
const jobsOf = async (id: number) => JOBS[id] ?? []

describe('realFailures', () => {
  it('never counts allow_failure jobs or the markers', () => {
    expect(realFailures(SUITE_RED, MARKERS).map((j) => j.name)).toEqual(['e2e-checks-and-build'])
  })
})

describe('latestAndGreen (sweep.py latest_and_green)', () => {
  it.each([
    [
      'running and no-op children are passed over; the green is the newest green before the red',
      [
        child(6, 'running'),
        child(4, 'failed'),
        child(3, 'success'),
        child(2, 'failed'),
        child(1, 'success')
      ],
      4,
      1
    ],
    ['a green newest needs no green before it', [child(5, 'success'), child(4, 'failed')], 5, null],
    ['only a no-op child', [child(3, 'success')], null, null]
  ] as [string, GitLabPipeline[], number | null, number | null][])(
    '%s',
    async (_name, pipelines, latest, green) => {
      const got = await latestAndGreen(pipelines, jobsOf, MARKERS)
      expect([got.latest?.pipeline.id ?? null, got.green?.id ?? null]).toEqual([latest, green])
    }
  )
})

const WHERE = {
  ref: 'dev',
  source: 'parent_pipeline',
  status: 'failed',
  select: 'newest_suite_running',
  marker_jobs: ['notify-slack', 'notify-slack-recovery']
}

function gitlab(pipelines: GitLabPipeline[]) {
  return fakeGlab((path) => {
    if (path === 'pipelines?source=parent_pipeline&ref=dev&order_by=id&sort=desc&per_page=30') {
      return pipelines
    }
    const jobs = /^pipelines\/(\d+)\/jobs\?per_page=100$/.exec(path)
    return jobs ? (JOBS[Number(jobs[1])] ?? []) : undefined
  })
}

describe('pipelineSource', () => {
  it('lists the newest red suite run with its failures and the last green', async () => {
    const api = gitlab([child(4, 'failed'), child(3, 'success'), child(1, 'success')])
    const source = pipelineSource()
    const { items } = await source.list(sourceContext({}, api), WHERE)
    expect(items.map((i) => [i.key, i.label])).toEqual([['pipeline:4', 'pipeline 4']])
    expect(items[0].fields).toMatchObject({
      'pipeline.id': 4,
      'pipeline.status': 'failed',
      'pipeline.short_sha': '444444444',
      'pipeline.ran_suite': true,
      'pipeline.failed_jobs': 'e2e-checks-and-build',
      'pipeline.failed_count': 1,
      'pipeline.green_id': 1,
      'pipeline.green_sha': '111111111111',
      'pipeline.green_url': 'https://gitlab.com/p/1'
    })
    expect(JSON.parse(String(items[0].fields['pipeline.failed_jobs_json']))).toEqual([
      {
        id: SUITE_RED[0].id,
        name: 'e2e-checks-and-build',
        web_url: 'https://gitlab.com/j/e2e-checks-and-build'
      }
    ])
    expect(source.scope(items[0], WHERE, null)).toEqual({ ok: true })
  })

  it('a green newest run is not due (13: "green")', async () => {
    const source = pipelineSource()
    const { items } = await source.list(
      sourceContext({}, gitlab([child(5, 'success'), child(4, 'failed')])),
      WHERE
    )
    expect(source.scope(items[0], WHERE, null)).toEqual({
      ok: false,
      verdict: 'notdue',
      reason: 'Pipeline 5 passed'
    })
  })

  it('lists nothing when no finished child ran the suite (13: "none")', async () => {
    const api = gitlab([child(6, 'running'), child(3, 'success')])
    expect((await pipelineSource().list(sourceContext({}, api), WHERE)).items).toEqual([])
  })

  it('needs marker_jobs to select suite runs', () => {
    const parsed = pipelineSource().whereSchema.safeParse({
      ref: 'dev',
      select: 'newest_suite_running'
    })
    expect(parsed.success).toBe(false)
  })

  it('fails closed on a malformed or possibly cut-short answer', async () => {
    const source = pipelineSource()
    const bad = fakeGlab(() => ({ message: 'nope' }))
    await expect(source.list(sourceContext({}, bad), WHERE)).rejects.toThrow('with a list')
    const full = Array.from({ length: 100 }, () => job('x'))
    const long = fakeGlab((path) => (path.startsWith('pipelines?') ? [child(4, 'failed')] : full))
    await expect(source.list(sourceContext({}, long), WHERE)).rejects.toThrow('cut short')
  })
})
