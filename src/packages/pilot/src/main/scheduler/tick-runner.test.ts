import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { parsePeopleYaml } from '../../shared/people'
import { createPassFetchCache } from '../sources/fetch-cache'
import type { GlabApi } from '../sources/gitlab-api'
import { PilotStore } from '../store/store'
import type { FactDeps } from '../fields/worktree-fields'
import { makeRunId, runTick, UnrecordedLaunchError, type TickDeps } from './tick-runner'

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
const RUN_ONCE = parseAutomationYaml(
  'name: Pull latest dev\nrepo: web-platform\nschedule: "0 6 * * *"\nsteps: [ { agent: shell, run: ./pull.sh } ]\n',
  '/a/pull-dev.yaml'
)
const DAILY = parseAutomationYaml(
  'name: Morning memo\nrepo: web-platform\nschedule: "0 6 * * *"\nonce_per: "{run.date}"\nsteps: [ { agent: claude, prompt: x } ]\n',
  '/a/memo.yaml'
)
const WORKTREES = parseAutomationYaml(
  'name: Review\nrepo: web-platform\nschedule: manual\nitems: { kind: worktree }\nsteps: [ { agent: claude, prompt: x } ]\n',
  '/a/review.yaml'
)
if (!RUN_ONCE.ok || !DAILY.ok || !WORKTREES.ok) {
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
  automationSessions: () => [],
  terminalAlive: async () => false
}

function deps(overrides: Partial<TickDeps> = {}): TickDeps & { launched: string[] } {
  const launched: string[] = []
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-tick-')), 'db.sqlite'))
  return {
    launched,
    store,
    now: () => Date.UTC(2026, 9, 10, 19, 10),
    resolveRepo: async () => ({ name: 'web-platform', id: 'r', path: '/repo', base: 'origin/dev' }),
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
  it('fails the tick, naming the kind, when no source lists its items yet', async () => {
    const result = await runTick(WORKTREES.definition, people.directory, deps(), { dryRun: false })
    expect(result).toMatchObject({ status: 'failed', error: "Pilot can't list worktree items yet" })
  })

  it('shares one GitLab read between the automations of a pass', async () => {
    const paths: string[] = []
    const spy: GlabApi = {
      projectPath: 'p',
      get: async <T>(path: string) => {
        paths.push(path)
        return api.get<T>(path)
      }
    }
    const pass = createPassFetchCache('pass-1', async () => spy)
    const d = deps()
    await runTick(def.definition, people.directory, d, { dryRun: true, pass })
    await runTick(baselineDef.definition, people.directory, d, { dryRun: true, pass })
    expect(paths).toEqual([
      'merge_requests?state=opened&author_username=nish8&per_page=100',
      'merge_requests/1561',
      'merge_requests/1574'
    ])
  })

  it.each([
    ['items.match', 'items: { kind: merge_request, match: ["{mr.iid} > 0"] }', ''],
    ['start: ask_first', '', 'start: ask_first\nask_first: { title: Go? }\n'],
    ['workspace: main_checkout', '', 'workspace: main_checkout\n'],
    ['workspace: new_worktree', '', 'workspace: { new_worktree: { base: origin/dev, name: x } }\n'],
    ['items.where.reviewer', 'items: { kind: merge_request, where: { reviewer: anyone } }', ''],
    ['items.where.draft', 'items: { kind: merge_request, where: { draft: false } }', ''],
    ['items.where.approved_by', 'items: { kind: merge_request, where: { approved_by: none } }', ''],
    [
      'items.where.target_branch',
      'items: { kind: merge_request, where: { target_branch: dev } }',
      ''
    ]
  ])('fails the tick, creating no runs, on %s until its task lands', async (key, items, extra) => {
    const parsed = parseAutomationYaml(
      `name: N\nrepo: web-platform\nschedule: manual\n${items || 'items: { kind: merge_request }'}\n${extra}steps: [ { agent: claude, prompt: hi } ]\n`,
      '/a/n.yaml'
    )
    if (!parsed.ok) {
      throw new Error(parsed.errors.join('\n'))
    }
    const d = deps()
    const result = await runTick(parsed.definition, people.directory, d, { dryRun: false })
    expect(result).toMatchObject({ status: 'failed', error: `${key} isn't supported yet` })
    expect(d.launched).toEqual([])
  })

  it('starts a run for each item that passes, records the tick and the once_per keys', async () => {
    const d = deps()
    const result = await runTick(def.definition, people.directory, d, {
      dryRun: false
    })
    expect(result.status).toBe('ok')
    expect(d.launched).toEqual(['mr:1561', 'mr:1574'])
    expect(d.store.handledKeys('fix-failed-ci')).toEqual(new Set(['1561:1561', '1574:1574']))
    expect(d.store.tickItems(result.tickId).map((i) => [i.itemKey, i.verdict, i.runId])).toEqual([
      ['mr:1561', 'started', makeRunId('fix-failed-ci', d.now(), 1, result.tickId)],
      ['mr:1574', 'started', makeRunId('fix-failed-ci', d.now(), 2, result.tickId)]
    ])
  })

  it('asks GitLab only for the definition author, so teammates never reach the tick', async () => {
    const paths: string[] = []
    const spy: GlabApi = {
      projectPath: 'p',
      get: async <T>(path: string) => {
        paths.push(path)
        return api.get<T>(path)
      }
    }
    const d = deps({ gitlab: async () => spy })
    await runTick(def.definition, people.directory, d, { dryRun: true })
    expect(paths.filter((p) => p.startsWith('merge_requests?'))).toEqual([
      'merge_requests?state=opened&author_username=nish8&per_page=100'
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
    expect(d.launched).toEqual(['mr:1561'])
    expect(d.store.handledKeys('fix-failed-ci')).toEqual(new Set(['1561:1561']))
    expect(d.store.runs.forTick(result.tickId).map((r) => [r.itemKey, r.status])).toEqual([
      ['mr:1561', 'running']
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

  it('resolves with a failed result even when finishTick throws', async () => {
    const d = deps({
      gitlab: async () => {
        throw new Error('glab down')
      }
    })
    d.store.finishTick = () => {
      throw new Error('store down')
    }
    const decideFail = await runTick(def.definition, people.directory, d, { dryRun: false })
    expect(decideFail).toMatchObject({ status: 'failed', error: 'glab down' })

    const w = deps()
    w.store.finishTick = () => {
      throw new Error('store down')
    }
    const writeFail = await runTick(def.definition, people.directory, w, { dryRun: false })
    expect(writeFail).toMatchObject({ status: 'failed', error: 'store down' })
  })

  it('still frees the key when the launch-failure bookkeeping partly throws', async () => {
    const d = deps({
      launch: async () => {
        throw new Error('gone')
      }
    })
    d.store.runs.update = () => {
      throw new Error('locked')
    }
    const result = await runTick(def.definition, people.directory, d, { dryRun: false })
    expect(result.status).toBe('ok')
    expect(d.store.handledKeys('fix-failed-ci').size).toBe(0)
  })

  it('fails only the run whose launch throws, and leaves its item due again (Review Focus 4)', async () => {
    const d = deps({
      launch: async (req) => {
        if (req.decision.key === 'mr:1561') {
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
      ['mr:1561', 'failed', "Couldn't start: worktree is gone"],
      ['mr:1574', 'running', null]
    ])
  })

  // The terminal exists, so the agent runs: freeing the key would let the next tick start a second one.
  it('keeps the key handled when a started terminal could not be recorded, and names it', async () => {
    const message = "terminal term_9 started but couldn't be recorded: disk full"
    const d = deps({
      launch: async (req) => {
        if (req.decision.key === 'mr:1561') {
          // As after a stale-start sweep freed the key during a slow launch.
          d.store.unmarkHandled('fix-failed-ci', req.decision.onceKey)
          throw new UnrecordedLaunchError('term_9', message)
        }
        return { terminalHandle: 'term_ok', paneKey: 'tab:leaf' }
      }
    })
    const result = await runTick(def.definition, people.directory, d, { dryRun: false })
    expect(result.status).toBe('ok')
    expect(d.store.handledKeys('fix-failed-ci')).toEqual(new Set(['1561:1561', '1574:1574']))
    expect(
      d.store.runs.forTick(result.tickId).map((r) => [r.itemKey, r.status, r.outcome])
    ).toEqual([
      ['mr:1561', 'failed', message],
      ['mr:1574', 'running', null]
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
    expect(d.store.tickItems(result.tickId).map((i) => [i.itemKey, i.verdict, i.runId])).toEqual([
      ['mr:1561', 'started', null],
      ['mr:1574', 'started', null]
    ])
    expect(d.store.runs.forTick(result.tickId)).toEqual([])
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
      ['mr:1561', 'notdue', 'Already handled 1561:1561'],
      ['mr:1574', 'notdue', 'Already handled 1574:1574']
    ])
    expect(d.launched).toEqual([])
    const t3 = await runTick(
      baselineDef.definition,
      people.directory,
      { ...d, gitlab: async () => makeApi((iid) => iid + 1000) },
      { dryRun: false }
    )
    expect(t3.decisions.map((x) => x.verdict)).toEqual(['started', 'started'])
    expect(d.launched).toEqual(['mr:1561', 'mr:1574'])
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

describe('runTick for a run-once automation', () => {
  it('starts one run on the repo every tick and keeps no handled key', async () => {
    const d = deps()
    const first = await runTick(RUN_ONCE.definition, people.directory, d, { dryRun: false })
    const second = await runTick(RUN_ONCE.definition, people.directory, d, { dryRun: false })
    for (const result of [first, second]) {
      expect(result.decisions.map((x) => [x.key, x.label, x.verdict])).toEqual([
        ['repo:web-platform', 'web-platform', 'started']
      ])
    }
    expect(d.launched).toEqual(['repo:web-platform', 'repo:web-platform'])
    expect(d.store.handledKeys('pull-dev').size).toBe(0)
    expect(d.store.seenKeys('pull-dev').size).toBe(0)
  })

  it('gives its one item the repo and run fields, the tick id included (G3)', async () => {
    const result = await runTick(RUN_ONCE.definition, people.directory, deps(), { dryRun: true })
    expect(result.decisions[0].fields).toMatchObject({
      'repo.name': 'web-platform',
      'repo.path': '/repo',
      'repo.base': 'origin/dev',
      'run.automation': 'pull-dev',
      'run.date': '20261010',
      'run.tick': result.tickId
    })
  })

  it('runs once per local day with once_per: "{run.date}" (Review Focus)', async () => {
    const d = deps()
    await runTick(DAILY.definition, people.directory, d, { dryRun: false })
    const again = await runTick(DAILY.definition, people.directory, d, { dryRun: false })
    expect(again.decisions.map((x) => [x.verdict, x.reason])).toEqual([
      ['notdue', 'Already handled 20261010']
    ])
    expect(d.launched).toEqual(['repo:web-platform'])
  })
})
