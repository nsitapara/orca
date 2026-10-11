import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { parsePeopleYaml } from '../../shared/people'
import type { GlabApi } from '../sources/gitlab-api'
import { PilotStore } from '../store/store'
import type { FactDeps } from '../fields/worktree-fields'
import { makeRunId, runTick, type TickDeps } from './tick-runner'

const YAML = `
name: Fix failed CI on my MRs
repo: web-platform
schedule: "10 * * * *"
items: { kind: merge_request, where: { state: open, author: { people: [nish] }, head_pipeline: failed } }
once_per: "{mr.iid}:{mr.pipeline}"
checks: [ { worktree: exists }, { worktree: clean } ]
steps: [ { agent: claude, skill: fix-gitlab-ci, prompt: "Fix {mr.pipeline} on !{mr.iid}" } ]
`
const def = parseAutomationYaml(YAML, '/a/fix-failed-ci.yaml')
const baselineDef = parseAutomationYaml(
  YAML.replace('once_per:', 'first_seen: baseline\nonce_per:'),
  '/a/fix-failed-ci.yaml'
)
const people = parsePeopleYaml('people:\n  - { id: nish, name: Nish, gitlab: nish8 }\n')
if (!def.ok || !baselineDef.ok || !people.ok) {
  throw new Error('setup')
}

function makeApi(pipelineId: (iid: number) => number): GlabApi {
  return {
    projectPath: 'p',
    async get<T>(path: string): Promise<T> {
      const mrs = [
        {
          iid: 1561,
          title: 'a',
          source_branch: 'web-1493-a',
          author: { username: 'nish8' },
          state: 'opened'
        },
        {
          iid: 1574,
          title: 'b',
          source_branch: 'web-1474-b',
          author: { username: 'nish8' },
          state: 'opened'
        }
      ]
      if (path.startsWith('merge_requests?')) {
        return mrs as T
      }
      const iid = Number(path.split('/')[1])
      const head_pipeline = { id: pipelineId(iid), status: 'failed' }
      return { ...mrs.find((m) => m.iid === iid), head_pipeline } as T
    }
  }
}
const api = makeApi((iid) => iid)
const facts: FactDeps = {
  listWorktrees: async () => [
    { id: 'r::/wt/1493', path: '/wt/1493', branch: 'web-1493-a' },
    { id: 'r::/wt/1474', path: '/wt/1474', branch: 'web-1474-b' }
  ],
  gitStatusCount: async () => 0,
  gitOperation: async () => null,
  openSessionHandles: () => [],
  terminalAlive: async () => false
}

function deps(overrides: Partial<TickDeps> = {}): TickDeps & { launched: string[] } {
  const launched: string[] = []
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-tick-')), 'db.sqlite'))
  return {
    launched,
    store,
    now: () => Date.UTC(2026, 9, 10, 19, 10),
    resolveRepo: async () => ({ id: 'r', path: '/repo' }),
    gitlab: async () => api,
    facts,
    quota: async () => ({ weekly: null, session: null }),
    launch: async (req) => {
      launched.push(req.decision.key)
      return {
        terminalHandle: `term_${req.decision.key}`,
        paneKey: 'tab:leaf'
      }
    },
    ...overrides
  }
}

describe('runTick', () => {
  it('starts a run for each item that passes, records the tick and the once_per keys', async () => {
    const d = deps()
    const result = await runTick(def.definition, people.directory, d, {
      dryRun: false
    })
    expect(result.status).toBe('ok')
    expect(d.launched).toEqual(['!1561', '!1574'])
    expect(d.store.handledKeys('fix-failed-ci')).toEqual(new Set(['1561:1561', '1574:1574']))
    expect(d.store.tickItems(result.tickId).map((i) => [i.itemKey, i.verdict, i.runId])).toEqual([
      ['!1561', 'started', makeRunId('fix-failed-ci', d.now(), 1, result.tickId)],
      ['!1574', 'started', makeRunId('fix-failed-ci', d.now(), 2, result.tickId)]
    ])
  })

  it('gives runs of two ticks in the same minute different ids', async () => {
    const d = deps({
      launch: async () => ({ terminalHandle: 't', paneKey: 'p' })
    })
    const first = await runTick(def.definition, people.directory, d, {
      dryRun: false
    })
    d.store.unmarkHandled('fix-failed-ci', '1561:1561')
    const second = await runTick(def.definition, people.directory, d, {
      dryRun: false
    })
    expect(second.decisions.map((x) => x.verdict)).toEqual(['started', 'notdue'])
    const ids = [first.tickId, second.tickId].flatMap((t) =>
      d.store.runs.forTick(t).map((r) => r.id)
    )
    expect(new Set(ids).size).toBe(3)
  })

  it('records a failed tick and writes no once_per keys when GitLab fails (Review Focus 3)', async () => {
    const d = deps({
      gitlab: async () => {
        throw new Error('glab: 502 Bad Gateway')
      }
    })
    const result = await runTick(def.definition, people.directory, d, {
      dryRun: false
    })
    expect(result).toMatchObject({
      status: 'failed',
      error: 'glab: 502 Bad Gateway'
    })
    expect(d.launched).toEqual([])
    expect(d.store.handledKeys('fix-failed-ci').size).toBe(0)
    expect(d.store.lastTick('fix-failed-ci')).toMatchObject({
      status: 'failed',
      error: 'glab: 502 Bad Gateway'
    })
  })

  it('fails the tick, starts nothing and writes no keys when the worktree list fails', async () => {
    const d = deps({
      facts: {
        ...facts,
        listWorktrees: async () => {
          throw new Error('repo not found')
        }
      }
    })
    const result = await runTick(def.definition, people.directory, d, {
      dryRun: false
    })
    expect(result).toMatchObject({ status: 'failed', error: 'repo not found' })
    expect(d.launched).toEqual([])
    expect(d.store.handledKeys('fix-failed-ci').size).toBe(0)
    expect(d.store.seenKeys('fix-failed-ci').size).toBe(0)
    expect(d.store.runs.forTick(result.tickId)).toEqual([])
    expect(d.store.lastTick('fix-failed-ci')).toMatchObject({
      status: 'failed',
      error: 'repo not found'
    })
  })

  it('records a non-Error throw as a failed tick with its text', async () => {
    const d = deps({
      gitlab: async () => {
        throw 'boom'
      }
    })
    const result = await runTick(def.definition, people.directory, d, { dryRun: false })
    expect(result).toMatchObject({ status: 'failed', error: 'boom' })
    expect(d.store.lastTick('fix-failed-ci')).toMatchObject({ status: 'failed', error: 'boom' })
  })

  it('never fails a tick because the quota reader throws', async () => {
    const d = deps({
      quota: async () => {
        throw new Error('no token')
      }
    })
    const result = await runTick(def.definition, people.directory, d, { dryRun: false })
    expect(result.status).toBe('ok')
    expect(result.decisions.map((x) => x.verdict)).toEqual(['started', 'started'])
  })

  it('finishes the tick as failed when the store throws mid-start, leaving no stuck run', async () => {
    const d = deps()
    const real = d.store.runs.create.bind(d.store.runs)
    let calls = 0
    d.store.runs.create = (run) => {
      calls += 1
      if (calls === 2) {
        throw new Error('disk full')
      }
      real(run)
    }
    const result = await runTick(def.definition, people.directory, d, { dryRun: false })
    expect(result).toMatchObject({ status: 'failed', error: 'disk full' })
    expect(d.store.lastTick('fix-failed-ci')).toMatchObject({
      status: 'failed',
      error: 'disk full'
    })
    expect(d.launched).toEqual(['!1561'])
    expect(d.store.handledKeys('fix-failed-ci')).toEqual(new Set(['1561:1561']))
    expect(d.store.runs.forTick(result.tickId).map((r) => [r.itemKey, r.status])).toEqual([
      ['!1561', 'running']
    ])
  })

  it('marks a created run failed and frees its key when the write phase throws before launch', async () => {
    const d = deps()
    const real = d.store.markHandled.bind(d.store)
    d.store.markHandled = (a, k, r, at) => {
      if (r !== null) {
        throw new Error('locked')
      }
      real(a, k, r, at)
    }
    const result = await runTick(def.definition, people.directory, d, { dryRun: false })
    expect(result).toMatchObject({ status: 'failed', error: 'locked' })
    expect(d.launched).toEqual([])
    expect(d.store.runs.forTick(result.tickId).map((r) => [r.status, r.outcome])).toEqual([
      ['failed', "Couldn't start: locked"]
    ])
    expect(d.store.runs.runningCount('fix-failed-ci')).toBe(0)
  })

  it('fails only the run whose launch throws, and leaves its item due again (Review Focus 4)', async () => {
    const d = deps({
      launch: async (req) => {
        if (req.decision.key === '!1561') {
          throw new Error('worktree is gone')
        }
        return { terminalHandle: 'term_ok', paneKey: 'tab:leaf' }
      }
    })
    const result = await runTick(def.definition, people.directory, d, {
      dryRun: false
    })
    expect(result.status).toBe('ok')
    expect(result.decisions.map((x) => x.verdict)).toEqual(['started', 'started'])
    expect(d.store.handledKeys('fix-failed-ci')).toEqual(new Set(['1574:1574']))
    const runs = d.store.runs.forTick(result.tickId)
    expect(runs.map((r) => [r.itemKey, r.status, r.outcome])).toEqual([
      ['!1561', 'failed', "Couldn't start: worktree is gone"],
      ['!1574', 'running', null]
    ])
  })

  it('changes nothing in a dry run except the recorded dry-run tick', async () => {
    const d = deps()
    const result = await runTick(def.definition, people.directory, d, {
      dryRun: true
    })
    expect(result.decisions.map((x) => x.verdict)).toEqual(['started', 'started'])
    expect(d.launched).toEqual([])
    expect(d.store.handledKeys('fix-failed-ci').size).toBe(0)
    expect(d.store.seenKeys('fix-failed-ci').size).toBe(0)
    expect(d.store.lastTick('fix-failed-ci')).toMatchObject({
      dryRun: true,
      status: 'ok'
    })
  })
})

describe('runTick with first_seen: baseline (R12)', () => {
  it('baselines on tick 1, skips as already handled on tick 2, starts when the once_per key changes', async () => {
    const d = deps()
    const run = () => runTick(baselineDef.definition, people.directory, d, { dryRun: false })
    const t1 = await run()
    expect(t1.decisions.map((x) => x.verdict)).toEqual(['baselined', 'baselined'])
    expect(d.launched).toEqual([])
    const t2 = await run()
    expect(t2.decisions.map((x) => [x.key, x.verdict, x.reason])).toEqual([
      ['!1561', 'notdue', 'Already handled 1561:1561'],
      ['!1574', 'notdue', 'Already handled 1574:1574']
    ])
    expect(d.launched).toEqual([])
    const t3 = await runTick(
      baselineDef.definition,
      people.directory,
      { ...d, gitlab: async () => makeApi((iid) => iid + 1000) },
      { dryRun: false }
    )
    expect(t3.decisions.map((x) => x.verdict)).toEqual(['started', 'started'])
    expect(d.launched).toEqual(['!1561', '!1574'])
  })

  it('writes no handled or seen keys when a dry run would baseline', async () => {
    const d = deps()
    const result = await runTick(baselineDef.definition, people.directory, d, {
      dryRun: true
    })
    expect(result.decisions.map((x) => x.verdict)).toEqual(['baselined', 'baselined'])
    expect(d.store.handledKeys('fix-failed-ci').size).toBe(0)
    expect(d.store.seenKeys('fix-failed-ci').size).toBe(0)
  })
})
