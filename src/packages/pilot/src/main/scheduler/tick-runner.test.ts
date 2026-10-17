import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import type { AutomationDefinition } from '../../shared/definition/types'
import { EMPTY_PEOPLE, parsePeopleYaml } from '../../shared/people'
import { fakeFieldDeps, testItem } from '../fields/__fixtures__/field-deps'
import type { FieldEngineDeps } from '../fields/engine'
import type { WorktreeInfo } from '../fields/worktree-facts'
import { runCapacity } from '../capacity/run-capacity'
import { makeLauncher } from '../run/__fixtures__/launcher'
import { runtimeWorkspaceDeps } from '../run/workspace'
import { createPassFetchCache } from '../sources/fetch-cache'
import type { Item, SourceContext } from '../sources/types'
import { PilotStore } from '../store/store'
import { registrySources, type SourceAccess } from './tick-decide'
import { makeRunId, runTick, UnrecordedLaunchError, type TickDeps } from './tick-runner'

const def = testDefinition({
  id: 'fix-failed-ci',
  file: '/a/fix-failed-ci.yaml',
  name: 'Fix failed CI on my MRs',
  oncePer: '{mr.iid}:{mr.pipeline}',
  checks: [{ kind: 'worktree_exists' }, { kind: 'worktree_clean' }]
})
const baselineDef = { ...def, firstSeen: 'baseline' as const }
const people = EMPTY_PEOPLE

function mrItem(iid: number, branch: string, pipeline: number): Item {
  return testItem({
    key: `mr:${iid}`,
    label: `!${iid}`,
    fields: { 'mr.iid': iid, 'mr.branch': branch, 'mr.pipeline': pipeline },
    worktreeHint: { branch }
  })
}
function sourcesWith(pipelineOf: (iid: number) => number = (iid) => iid): SourceAccess {
  return {
    list: async () => ({
      items: [
        mrItem(1561, 'web-1493-a', pipelineOf(1561)),
        mrItem(1574, 'web-1474-b', pipelineOf(1574))
      ],
      warnings: []
    }),
    scope: () => null
  }
}
const failingSources = (error: unknown): SourceAccess => ({
  list: async () => {
    throw error
  },
  scope: () => null
})
const repoItem = testItem({ kind: 'repo', key: 'repo:web-platform', label: 'web-platform' })
const repoSources: SourceAccess = {
  list: async () => ({ items: [repoItem], warnings: [] }),
  scope: () => null
}
const worktrees: WorktreeInfo[] = [
  {
    id: 'r::/wt/1493',
    path: '/wt/1493',
    branch: 'web-1493-a',
    head: 'h1',
    linkedLinearIssue: null
  },
  { id: 'r::/wt/1474', path: '/wt/1474', branch: 'web-1474-b', head: 'h2', linkedLinearIssue: null }
]
const fieldsWith = (over: Partial<FieldEngineDeps> = {}) =>
  fakeFieldDeps({ listWorktrees: async () => worktrees, ...over })

function deps(overrides: Partial<TickDeps> = {}): TickDeps & { launched: string[] } {
  const launched: string[] = []
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-tick-')), 'db.sqlite'))
  return {
    launched,
    store,
    now: () => Date.UTC(2026, 9, 10, 19, 10),
    resolveRepo: async () => ({ name: 'web-platform', id: 'r', path: '/repo', base: 'origin/dev' }),
    sources: sourcesWith(),
    fields: fieldsWith(),
    ask: {
      store,
      now: () => 0,
      inbox: { store, now: () => 0, definitions: () => [], people: () => EMPTY_PEOPLE }
    },
    launch: async (req) => {
      launched.push(req.decision.key)
      return { terminalHandle: `term_${req.decision.key}`, paneKey: 'tab:leaf' }
    },
    ...overrides
  }
}

describe('runTick', () => {
  it('starts a run for each item that passes, records the tick and the once_per keys', async () => {
    const d = deps()
    const result = await runTick(def, people, d, { dryRun: false })
    expect(result.status).toBe('ok')
    expect(d.launched).toEqual(['mr:1561', 'mr:1574'])
    expect(d.store.handledKeys('fix-failed-ci')).toEqual(new Set(['1561:1561', '1574:1574']))
    expect(d.store.tickItems(result.tickId).map((i) => [i.itemKey, i.verdict, i.runId])).toEqual([
      ['mr:1561', 'started', makeRunId('fix-failed-ci', d.now(), 1, result.tickId)],
      ['mr:1574', 'started', makeRunId('fix-failed-ci', d.now(), 2, result.tickId)]
    ])
    expect(d.store.runs.forTick(result.tickId).map((r) => r.worktreePath)).toEqual([
      '/wt/1493',
      '/wt/1474'
    ])
  })

  it.each([
    ['the schedule', 'schedule', false],
    ['Run now', 'manual', true]
  ])('stores the runs a tick by %s starts with trigger %s', async (_by, trigger, byHand) => {
    const d = deps()
    const result = await runTick(def, people, d, { dryRun: false, byHand })
    expect(d.store.runs.forTick(result.tickId).map((r) => r.trigger)).toEqual([trigger, trigger])
  })

  it('gives runs of two ticks in the same minute different ids', async () => {
    const d = deps({ launch: async () => ({ terminalHandle: 't', paneKey: 'p' }) })
    const first = await runTick(def, people, d, { dryRun: false })
    d.store.unmarkHandled('fix-failed-ci', '1561:1561')
    d.store.runs.forTick(first.tickId).forEach((r) => d.store.runs.update(r.id, { status: 'done' }))
    const second = await runTick(def, people, d, { dryRun: false })
    expect(second.decisions.map((x) => x.verdict)).toEqual(['started', 'notdue'])
    const ids = [first.tickId, second.tickId].flatMap((t) =>
      d.store.runs.forTick(t).map((r) => r.id)
    )
    expect(new Set(ids).size).toBe(3)
  })

  it('records a failed tick and writes no once_per keys when the source fails (Review Focus 3)', async () => {
    const d = deps({ sources: failingSources(new Error('glab: 502 Bad Gateway')) })
    const result = await runTick(def, people, d, { dryRun: false })
    expect(result).toMatchObject({
      status: 'failed',
      error: 'glab: 502 Bad Gateway',
      warnings: []
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
      fields: fieldsWith({
        listWorktrees: async () => {
          throw new Error('repo not found')
        }
      })
    })
    const result = await runTick(def, people, d, { dryRun: false })
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
    const d = deps({ sources: failingSources('boom') })
    const result = await runTick(def, people, d, { dryRun: false })
    expect(result).toMatchObject({ status: 'failed', error: 'boom' })
    expect(d.store.lastTick('fix-failed-ci')).toMatchObject({ status: 'failed', error: 'boom' })
  })

  it('never fails a tick because a quota reader throws', async () => {
    const broken = async () => {
      throw new Error('no token')
    }
    const d = deps({ fields: fieldsWith({ quotas: { claude: broken, codex: broken } }) })
    const result = await runTick(def, people, d, { dryRun: false })
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
    const result = await runTick(def, people, d, { dryRun: false })
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
    const result = await runTick(def, people, d, { dryRun: false })
    expect(result).toMatchObject({ status: 'failed', error: 'locked' })
    expect(d.launched).toEqual([])
    expect(d.store.runs.forTick(result.tickId).map((r) => [r.status, r.outcome])).toEqual([
      ['failed', "Couldn't start: locked"]
    ])
    expect(d.store.runs.runningCount('fix-failed-ci')).toBe(0)
  })

  it('skips an item whose worktree another run took between deciding and starting, and leaves its key free', async () => {
    const d = deps()
    d.launch = async (req) => {
      d.launched.push(req.decision.key)
      // Another automation's tick starts an agent in the second item's worktree meanwhile.
      const otherTick = d.store.startTick('other', d.now())
      d.store.runs.create({
        id: 'other-run',
        automationId: 'other',
        tickId: otherTick,
        itemKey: 'mr:1',
        itemLabel: 'x',
        worktreePath: '/wt/1474',
        startedAt: d.now()
      })
      return { terminalHandle: 't', paneKey: 'p' }
    }
    const result = await runTick(def, people, d, { dryRun: false })
    expect(result.status).toBe('ok')
    expect(d.launched).toEqual(['mr:1561'])
    expect(result.decisions.map((x) => [x.key, x.verdict, x.reason])).toEqual([
      ['mr:1561', 'started', expect.any(String)],
      ['mr:1574', 'skipped', 'Another run is active in /wt/1474']
    ])
    expect(d.store.handledKeys('fix-failed-ci')).toEqual(new Set(['1561:1561']))
    expect(d.store.tickItems(result.tickId).map((i) => [i.itemKey, i.verdict, i.runId])).toEqual([
      ['mr:1561', 'started', expect.any(String)],
      ['mr:1574', 'skipped', null]
    ])
  })

  const otherRunAt = (d: ReturnType<typeof deps>, path: string) => {
    const tick = d.store.startTick('other', d.now())
    d.store.runs.create({
      id: `other-${path}`,
      automationId: 'other',
      tickId: tick,
      itemKey: 'x',
      itemLabel: 'x',
      worktreePath: path,
      startedAt: d.now()
    })
  }

  it("starts an item_worktree item whose worktree is the repo's shared main checkout, even with a run there", async () => {
    const d = deps({
      fields: fieldsWith({
        listWorktrees: async () => [{ ...worktrees[0], path: '/repo//' }, worktrees[1]]
      })
    })
    otherRunAt(d, '/repo')
    const result = await runTick(def, people, d, { dryRun: false })
    expect(result.decisions.map((x) => [x.key, x.verdict])).toEqual([
      ['mr:1561', 'started'],
      ['mr:1574', 'started']
    ])
  })

  it('starts a run-once main_checkout automation while another run is active in the main checkout', async () => {
    const runOnce = testDefinition({
      id: 'pull-dev',
      items: null,
      workspace: { kind: 'main_checkout' }
    })
    const d = deps({ sources: repoSources })
    otherRunAt(d, '/repo')
    const result = await runTick(runOnce, people, d, { dryRun: false })
    expect(result.decisions.map((x) => x.verdict)).toEqual(['started'])
    expect(d.launched).toEqual(['repo:web-platform'])
  })

  it('resolves with a failed result even when finishTick throws', async () => {
    const d = deps({ sources: failingSources(new Error('glab down')) })
    d.store.finishTick = () => {
      throw new Error('store down')
    }
    expect(await runTick(def, people, d, { dryRun: false })).toMatchObject({
      status: 'failed',
      error: 'glab down'
    })
    const w = deps()
    w.store.finishTick = () => {
      throw new Error('store down')
    }
    expect(await runTick(def, people, w, { dryRun: false })).toMatchObject({
      status: 'failed',
      error: 'store down'
    })
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
    const result = await runTick(def, people, d, { dryRun: false })
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
    const result = await runTick(def, people, d, { dryRun: false })
    expect(result.status).toBe('ok')
    expect(result.decisions.map((x) => x.verdict)).toEqual(['started', 'started'])
    expect(d.store.handledKeys('fix-failed-ci')).toEqual(new Set(['1574:1574']))
    expect(
      d.store.runs.forTick(result.tickId).map((r) => [r.itemKey, r.status, r.outcome])
    ).toEqual([
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
          d.store.unmarkHandled('fix-failed-ci', req.decision.onceKey)
          throw new UnrecordedLaunchError('term_9', message)
        }
        return { terminalHandle: 'term_ok', paneKey: 'tab:leaf' }
      }
    })
    const result = await runTick(def, people, d, { dryRun: false })
    expect(result.status).toBe('ok')
    expect(d.store.handledKeys('fix-failed-ci')).toEqual(new Set(['1561:1561', '1574:1574']))
    expect(
      d.store.runs.forTick(result.tickId).map((r) => [r.itemKey, r.status, r.outcome])
    ).toEqual([
      ['mr:1561', 'failed', message],
      ['mr:1574', 'running', null]
    ])
  })

  it('stores nothing in a dry run, whether it decides or fails: no tick, no runs, no keys', async () => {
    const d = deps()
    const result = await runTick(def, people, d, { dryRun: true })
    expect(result).toMatchObject({ tickId: null, status: 'ok' })
    expect(result.decisions.map((x) => x.verdict)).toEqual(['started', 'started'])
    expect(d.launched).toEqual([])
    expect(d.store.handledKeys('fix-failed-ci').size).toBe(0)
    expect(d.store.seenKeys('fix-failed-ci').size).toBe(0)
    expect(d.store.lastTick('fix-failed-ci')).toBeNull()
    const failing = deps({ sources: failingSources(new Error('glab: 502 Bad Gateway')) })
    expect(await runTick(def, people, failing, { dryRun: true })).toMatchObject({
      tickId: null,
      status: 'failed',
      error: 'glab: 502 Bad Gateway'
    })
    expect(failing.store.lastTick('fix-failed-ci')).toBeNull()
  })
})

describe('runTick with first_seen: baseline (R12)', () => {
  it('baselines on tick 1, skips as already handled on tick 2, starts when the once_per key changes', async () => {
    const d = deps()
    const run = () => runTick(baselineDef, people, d, { dryRun: false })
    expect((await run()).decisions.map((x) => x.verdict)).toEqual(['baselined', 'baselined'])
    expect((await run()).decisions.map((x) => [x.key, x.verdict, x.reason])).toEqual([
      ['mr:1561', 'notdue', 'Already handled 1561:1561'],
      ['mr:1574', 'notdue', 'Already handled 1574:1574']
    ])
    expect(d.launched).toEqual([])
    const t3 = await runTick(
      baselineDef,
      people,
      { ...d, sources: sourcesWith((iid) => iid + 1000) },
      { dryRun: false }
    )
    expect(t3.decisions.map((x) => x.verdict)).toEqual(['started', 'started'])
    expect(d.launched).toEqual(['mr:1561', 'mr:1574'])
  })

  it('writes no handled or seen keys when a dry run would baseline', async () => {
    const d = deps()
    const result = await runTick(baselineDef, people, d, { dryRun: true })
    expect(result.decisions.map((x) => x.verdict)).toEqual(['baselined', 'baselined'])
    expect(d.store.handledKeys('fix-failed-ci').size).toBe(0)
    expect(d.store.seenKeys('fix-failed-ci').size).toBe(0)
  })
})

const newWorktree = (name: string) => ({
  kind: 'new_worktree' as const,
  base: 'origin/dev',
  name,
  reuseExisting: false,
  setup: 'skip' as const
})

// Task 8d: through the real launcher and the real worktree claim. Each new worktree's create also
// records what its run and step 0 looked like then: the run row exists (running) before the
// workspace is resolved, and step 0 waits as `pending` until it exists (B8).
function launching(create: (name: string) => Promise<{ id: string; path: string }>) {
  const d = deps()
  const selectors: string[] = []
  const atCreate: string[] = []
  const createManagedWorktree = async (req: { name: string; comment: string }) => {
    const runId = /\(run (.+)\)$/.exec(req.comment)?.[1] ?? ''
    atCreate.push(`${d.store.runs.get(runId)?.status}/${d.store.runs.steps(runId)[0]?.status}`)
    return { worktree: await create(req.name) }
  }
  const runtime = { createManagedWorktree } as unknown as OrcaRuntimeService
  d.launch = makeLauncher(d.store, {
    workspace: runtimeWorkspaceDeps(runtime, async () => worktrees, d.store.runs),
    launchTerminal: async (selector) => {
      selectors.push(selector)
      return { handle: `term_${selectors.length}`, paneKey: 'tab:leaf' }
    },
    modeText: async () => null,
    newSessionId: () => '00000000-0000-4000-8000-000000000051',
    now: d.now,
    transcriptExists: async () => true
  })
  return { d, selectors, atCreate }
}
const created = async (name: string) => ({ id: `r::/wt/${name}`, path: `/wt/${name}` })

describe('runTick launching into each workspace (Task 8d)', () => {
  it.each<[string, AutomationDefinition, string[], string[], string[]]>([
    [
      'main_checkout for items',
      { ...def, workspace: { kind: 'main_checkout' } },
      ['path:/repo', 'path:/repo'],
      ['/repo', '/repo'],
      []
    ],
    [
      'main_checkout for a run-once automation',
      testDefinition({ id: 'fix-failed-ci', items: null, workspace: { kind: 'main_checkout' } }),
      ['path:/repo'],
      ['/repo'],
      []
    ],
    [
      'new_worktree for items',
      { ...def, workspace: newWorktree('fix-{mr.iid}') },
      ['id:r::/wt/fix-1561', 'id:r::/wt/fix-1574'],
      ['/wt/fix-1561', '/wt/fix-1574'],
      ['running/pending', 'running/pending']
    ],
    [
      'new_worktree for a run-once automation',
      testDefinition({
        id: 'fix-failed-ci',
        items: null,
        workspace: newWorktree('memo-{run.date}')
      }),
      ['id:r::/wt/memo-20261010'],
      ['/wt/memo-20261010'],
      ['running/pending']
    ]
  ])('starts %s', async (_name, automation, selectors, paths, atCreate) => {
    const run = launching(created)
    const sources = automation.items === null ? repoSources : sourcesWith()
    const result = await runTick(automation, people, { ...run.d, sources }, { dryRun: false })
    expect(result.status).toBe('ok')
    expect(run.selectors).toEqual(selectors)
    expect(run.atCreate).toEqual(atCreate)
    const runs = run.d.store.runs.forTick(result.tickId)
    expect(runs.map((r) => [r.status, r.worktreePath])).toEqual(paths.map((p) => ['running', p]))
    expect(runs.map((r) => run.d.store.runs.steps(r.id)[0]?.status)).toEqual(
      paths.map(() => 'running')
    )
  })

  it("fails the step and the run, and frees the item's key, when its new worktree can't be made", async () => {
    const run = launching(async () => {
      throw new Error('git worktree add failed')
    })
    const result = await runTick(
      { ...def, workspace: newWorktree('fix-{mr.iid}') },
      people,
      run.d,
      {
        dryRun: false
      }
    )
    expect(result.status).toBe('ok')
    expect(run.selectors).toEqual([])
    const runs = run.d.store.runs.forTick(result.tickId)
    expect(runs.map((r) => [r.status, r.outcome])).toEqual([
      ['failed', "Couldn't start: git worktree add failed"],
      ['failed', "Couldn't start: git worktree add failed"]
    ])
    expect(runs.map((r) => run.d.store.runs.steps(r.id)[0])).toMatchObject([
      { status: 'failed', error: 'git worktree add failed' },
      { status: 'failed', error: 'git worktree add failed' }
    ])
    expect(run.d.store.handledKeys('fix-failed-ci').size).toBe(0)
  })

  // H10: per_worktree in the main checkout is one session for the repo. The second item would resume it
  // while the first item's agent still runs it, so its step fails and no second terminal opens.
  it('fails the second item, opening no second terminal, when both would resume one per-worktree session', async () => {
    const run = launching(created)
    const shared: AutomationDefinition = {
      ...def,
      workspace: { kind: 'main_checkout' },
      steps: [testStep({ session: { kind: 'per_worktree' } })]
    }
    const result = await runTick(shared, people, run.d, { dryRun: false })
    expect(result.status).toBe('ok')
    expect(run.selectors).toEqual(['path:/repo'])
    const busy =
      "Couldn't start: Session 00000000-0000-4000-8000-000000000051 is busy in Fix failed CI on my MRs · !1561"
    expect(
      run.d.store.runs.forTick(result.tickId).map((r) => [r.itemKey, r.status, r.outcome])
    ).toEqual([
      ['mr:1561', 'running', null],
      ['mr:1574', 'failed', busy]
    ])
    expect(run.d.store.handledKeys('fix-failed-ci')).toEqual(new Set(['1561:1561']))
  })
})

const whereOf = (where: Record<string, unknown>) => ({
  items: { kind: 'merge_request' as const, where, match: [], customFields: [] }
})

describe('runTick with start: ask_first (Task 25)', () => {
  const askDef: AutomationDefinition = {
    ...def,
    start: 'ask_first',
    askFirst: { title: 'Fix !{mr.iid}?', context: '', options: [] },
    inbox: 'nish'
  }
  const asking = parsePeopleYaml('people:\n  - { id: nish, name: Nish }\n')

  it('asks first: a card and an asking run per item, the keys handled, nothing launched', async () => {
    const d = deps()
    if (!asking.ok) {
      throw new Error('setup')
    }
    const directory = asking.directory
    d.ask.inbox.definitions = () => [askDef]
    d.ask.inbox.people = () => directory
    const result = await runTick(askDef, directory, d, { dryRun: false })
    expect(result.status).toBe('ok')
    expect(d.launched).toEqual([])
    expect(
      d.store.runs.forTick(result.tickId).map((r) => [r.itemKey, r.status, r.trigger])
    ).toEqual([
      ['mr:1561', 'asking', 'ask_first'],
      ['mr:1574', 'asking', 'ask_first']
    ])
    expect(
      d.store.inbox
        .list({ automationId: 'fix-failed-ci' })
        .map((i) => [i.title, i.action])
        .toSorted()
    ).toEqual([
      ['Fix !1561?', 'start_run'],
      ['Fix !1574?', 'start_run']
    ])
    expect(d.store.handledKeys('fix-failed-ci')).toEqual(new Set(['1561:1561', '1574:1574']))
    expect(d.store.tickItems(result.tickId).map((i) => [i.verdict, i.runId])).toEqual([
      ['asked', `${makeRunId('fix-failed-ci', d.now(), 1, result.tickId)}-ask`],
      ['asked', `${makeRunId('fix-failed-ci', d.now(), 2, result.tickId)}-ask`]
    ])
  })

  it('files nothing on a dry run', async () => {
    const d = deps()
    const result = await runTick(askDef, people, d, { dryRun: true })
    expect(result.decisions.map((x) => x.verdict)).toEqual(['asked', 'asked'])
    expect(result.tickId).toBeNull()
    expect(d.store.inbox.list({})).toEqual([])
  })
})

// The where schemas are strict (shared/definition/where.ts): a file naming a key no source reads never
// parses, so every key a definition can carry is one its source acts on.
describe('runTick on the where keys and match', () => {
  // Task 14c: the MR source reads reviewers, drafts, approvals and target branches.
  it('ticks on every merge_request where key now that the MR source reads them', async () => {
    const every = whereOf({
      state: 'open',
      author: 'anyone',
      reviewer: 'anyone',
      head_pipeline: 'any',
      draft: false,
      approved_by: 'none',
      target_branch: 'dev'
    })
    const result = await runTick({ ...def, ...every }, people, deps(), { dryRun: true })
    expect(result).toMatchObject({ status: 'ok', error: null })
    expect(result.decisions.map((x) => x.key)).toEqual(['mr:1561', 'mr:1574'])
  })

  it('decides on items.match now that the tick evaluates it', async () => {
    const matching = {
      ...def,
      items: {
        kind: 'merge_request' as const,
        where: {},
        match: ['{mr.iid} > 1570'],
        customFields: []
      }
    }
    const result = await runTick(matching, people, deps(), { dryRun: true })
    expect(result.decisions.map((x) => [x.key, x.verdict, x.reason])).toEqual([
      ['mr:1561', 'out_of_scope', 'Doesn\'t match "{mr.iid} > 1570"'],
      ['mr:1574', 'started', 'All checks pass']
    ])
  })
})

describe('runTick v2', () => {
  // G2/B2: the main checkout is shared by design, so a run-once job there is not skipped by another run there.
  it('runs a run-once automation every tick, even while a run is still going in the main checkout, keeping no once_per or seen memory', async () => {
    const runOnce = testDefinition({
      id: 'pull-dev',
      items: null,
      workspace: { kind: 'main_checkout' }
    })
    const d = deps({ sources: repoSources })
    const first = await runTick(runOnce, people, d, { dryRun: false })
    expect(first.decisions.map((x) => x.verdict)).toEqual(['started'])
    expect(d.store.runs.forTick(first.tickId)[0].worktreePath).toBe('/repo')
    const second = await runTick(runOnce, people, d, { dryRun: false })
    expect(second.decisions.map((x) => [x.verdict, x.reason])).toEqual([
      ['started', 'All checks pass']
    ])
    expect(d.store.runs.forTick(second.tickId)[0].worktreePath).toBe('/repo')
    expect(d.store.handledKeys('pull-dev').size).toBe(0)
    expect(d.store.seenKeys('pull-dev').size).toBe(0)
  })

  it('gives a run-once item the repo fields', async () => {
    const runOnce = testDefinition({
      id: 'pull-dev',
      items: null,
      workspace: { kind: 'main_checkout' }
    })
    const result = await runTick(runOnce, people, deps({ sources: repoSources }), { dryRun: true })
    expect(result.decisions[0].fields).toMatchObject({
      'repo.name': 'web-platform',
      'repo.path': '/repo'
    })
  })

  it('fails the tick on an item kind no source lists yet', async () => {
    const tickets = {
      ...def,
      items: { kind: 'linear_ticket' as const, where: {}, match: [], customFields: [] }
    }
    const d = deps({ sources: registrySources })
    const result = await runTick(tickets, people, d, { dryRun: false })
    expect(result).toMatchObject({
      status: 'failed',
      error: "Pilot can't list Linear tickets yet"
    })
    expect(d.store.lastTick('fix-failed-ci')).toMatchObject({ status: 'failed' })
  })

  // Task 6a ruling: a run-once automation keeps its once_per gate when it sets one.
  it('runs a run-once automation once per local day with once_per: "{run.date}" (Review Focus 3)', async () => {
    const daily = testDefinition({
      id: 'memo',
      items: null,
      workspace: { kind: 'main_checkout' },
      oncePer: '{run.date}'
    })
    const d = deps({ sources: repoSources })
    await runTick(daily, people, d, { dryRun: false })
    const again = await runTick(daily, people, d, { dryRun: false })
    expect(again.decisions.map((x) => [x.verdict, x.reason])).toEqual([
      ['notdue', 'Already handled 20261010']
    ])
    expect(d.launched).toEqual(['repo:web-platform'])
    expect(d.store.handledKeys('memo')).toEqual(new Set(['20261010']))
    expect(d.store.seenKeys('memo').size).toBe(0)
  })

  it('returns the warnings of the source and field scripts with the result', async () => {
    const d = deps({
      sources: {
        ...sourcesWith(),
        list: async () => ({ items: [], warnings: ['GitLab listed 100 of 120 MRs'] })
      }
    })
    const result = await runTick(def, people, d, { dryRun: false })
    expect(result.warnings).toEqual(['GitLab listed 100 of 120 MRs'])
    // and on the tick itself, so Activity shows them
    expect(d.store.listTicks(def.id, 1)[0].warnings).toEqual(['GitLab listed 100 of 120 MRs'])
  })

  it('reads through the pass it is given', async () => {
    let seen: SourceContext | null = null
    const d = deps({
      sources: {
        list: async (_def, ctx) => {
          seen = ctx
          return { items: [], warnings: [] }
        },
        scope: () => null
      }
    })
    const pass = createPassFetchCache('pass-1', async () => {
      throw new Error('no GitLab in this test')
    })
    await runTick(def, people, d, { dryRun: true, pass })
    expect((seen as SourceContext | null)?.fetch).toBe(pass)
  })

  it('makes a pass of its own, named for the tick or the dry run, when it is given none', async () => {
    let seen: SourceContext | null = null
    const d = deps({
      sources: {
        list: async (_def, ctx) => {
          seen = ctx
          return { items: [], warnings: [] }
        },
        scope: () => null
      }
    })
    const result = await runTick(def, people, d, { dryRun: false })
    expect((seen as SourceContext | null)?.fetch.passId).toBe(`tick-${result.tickId}`)
    await runTick(def, people, d, { dryRun: true })
    expect((seen as SourceContext | null)?.fetch.passId).toBe('dry-run-fix-failed-ci')
  })
})

describe('runTick with a run limit', () => {
  it('queues an item past the limit, then starts it as Run now asked once a slot frees', async () => {
    const d = deps()
    const capacity = runCapacity({ store: d.store, definitions: () => [def], now: d.now })
    d.store.capacity.setRunLimit(1, 0)
    const first = await runTick(def, people, { ...d, capacity }, { dryRun: false, byHand: true })
    expect(d.launched).toEqual(['mr:1561'])
    expect(d.store.tickItems(first.tickId).map((i) => [i.itemKey, i.verdict, i.reason])).toEqual([
      ['mr:1561', 'started', 'All checks pass'],
      ['mr:1574', 'queued', 'Waiting for a slot: 1 of 1 running']
    ])
    expect(d.store.capacity.queued().map((q) => [q.itemKey, q.byHand])).toEqual([['mr:1574', true]])
    for (const run of d.store.runs.forTick(first.tickId)) {
      d.store.runs.update(run.id, { status: 'done', finishedAt: d.now() })
    }
    const second = await runTick(def, people, { ...d, capacity }, { dryRun: false })
    expect(d.launched).toEqual(['mr:1561', 'mr:1574'])
    expect(d.store.runs.forTick(second.tickId).map((r) => [r.itemKey, r.trigger])).toEqual([
      ['mr:1574', 'manual']
    ])
    expect(d.store.capacity.queued()).toEqual([])
  })

  it("drops a job's queued items when its tick fails, so they can't hold the line", async () => {
    const d = deps({ sources: failingSources(new Error('glab is down')) })
    d.store.capacity.enqueue({
      automationId: def.id,
      itemKey: 'mr:1561',
      itemLabel: '!1561',
      queuedAt: 1,
      byHand: false
    })
    const capacity = runCapacity({ store: d.store, definitions: () => [def], now: d.now })
    const result = await runTick(def, people, { ...d, capacity }, { dryRun: false })
    expect(result.status).toBe('failed')
    expect(d.store.capacity.queued()).toEqual([])
  })
})
