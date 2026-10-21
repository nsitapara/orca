import { describe, expect, it } from 'vitest'
import type { TickTrigger } from '../../shared/api-types-handover'
import { testDefinition } from '../../shared/definition/__fixtures__/definition'
import type { PilotcliCall, PilotcliReply } from '../envs/pilotcli'
import { PilotStore } from '../store/store'
import { sourceContext } from './__fixtures__/source-context'
import { keptBranchSource, keptRefsOf, triggerKeptJobs, type KeptRef } from './kept-branches'

const ORIGIN_YAML =
  'name: 03 · Review\nrepo: web-platform\nschedule: manual\nsteps:\n  - agent: claude\n    prompt: Review\n'
const reply = (outcome: PilotcliReply['outcome'], reason = ''): PilotcliReply => ({
  outcome,
  reason,
  data: null,
  code: 0
})

type Case = {
  dryRun?: PilotcliReply
  // The pilot/ branches git has in /repo (default: pilot/r1 at abc123).
  refs?: KeptRef[] | null
  // What env delete reported keeping for r1 (default: pilot/r1).
  kept?: string | null
  status?: 'done' | 'running'
  worktrees?: string[]
  repo?: string
  holder?: boolean
}

function setup(c: Case) {
  const store = PilotStore.open(':memory:')
  store.definitions.saveValid(testDefinition({ id: 'review' }), ORIGIN_YAML, 1)
  store.runs.create({
    id: 'r1',
    automationId: 'review',
    tickId: null,
    itemKey: 'wt:a',
    itemLabel: 'a',
    worktreePath: '/agents/agents-r1',
    startedAt: 1
  })
  store.runs.envs.begin('r1', '/wt/a', {})
  store.runs.envs.ready('r1', {
    mode: 'throwaway',
    reason: 'uncommitted changes',
    path: '/agents/agents-r1',
    home: '/wt/a',
    worktreeId: 'id',
    sha: null,
    envFile: null,
    vars: {},
    stack: null
  })
  if (c.status !== 'running') {
    store.runs.update('r1', { status: 'done', finishedAt: 4 })
    const kept = c.kept === undefined ? 'pilot/r1' : c.kept
    store.runs.envs.removed('r1', 5, kept ?? undefined)
  }
  if (c.holder) {
    store.runs.create({
      id: 'r2',
      automationId: 'review',
      tickId: null,
      itemKey: 'wt:a',
      itemLabel: 'a',
      worktreePath: '/wt/a',
      startedAt: 10
    })
  }
  const calls: string[][] = []
  const refs = c.refs === undefined ? [{ branch: 'pilot/r1', head: 'abc123' }] : c.refs
  const source = keptBranchSource({
    store,
    listWorktrees: async () =>
      (c.worktrees ?? ['/wt/a']).map((path) => ({
        id: path,
        path,
        branch: 'b',
        head: 'h',
        isArchived: false,
        isMain: false,
        linkedLinearIssue: null
      })),
    pilotcli: async (call: PilotcliCall) => {
      calls.push([...call.args])
      return c.dryRun ?? reply('ok')
    },
    keptBranches: async (path) => (path === '/repo' ? refs : []),
    now: () => 99
  })
  const ctx = sourceContext(
    c.repo ? { repo: { id: 'o', name: c.repo, path: '/other', base: null } } : {}
  )
  return { store, source, ctx, calls }
}

const r1 = (wait: string, branch = 'pilot/r1') => ({
  key: 'kept:r1',
  label: `${branch} → a`,
  fields: {
    'kept.branch': branch,
    'kept.head': 'abc123',
    'kept.run': 'r1',
    'kept.job': '03 · Review',
    'kept.wait': wait,
    'kept.tries': 0,
    'worktree.path': '/wt/a'
  }
})

describe('kept branch source', () => {
  it.each<[string, Case, ReturnType<typeof r1>[]]>([
    ['a merge that can land now waits for nothing', {}, [r1('')]],
    [
      'a merge that would conflict waits for nothing: the job resolves it',
      { dryRun: reply('skip', 'conflicts in 1 file: a.ts') },
      [r1('')]
    ],
    [
      'a merge my local changes block waits with pilotcli’s reason',
      { dryRun: reply('skip', 'the merge changes 1 file you have local changes in: a.ts') },
      [r1('the merge changes 1 file you have local changes in: a.ts')]
    ],
    [
      'another Pilot run in the home worktree waits for it',
      { holder: true },
      [r1('03 · Review is already working in /wt/a (Pilot run r2)')]
    ],
    [
      'a home worktree that is gone waits for me',
      { worktrees: [] },
      [r1('its worktree /wt/a is gone; merge or delete pilot/r1 by hand')]
    ],
    ['a branch env delete never reported is still an item', { kept: null }, [r1('')]],
    [
      "a skill's own branch is found by the run id it ends in",
      { kept: null, refs: [{ branch: 'pilot/ui-qa-r1', head: 'abc123' }] },
      [r1('', 'pilot/ui-qa-r1')]
    ],
    ['a branch already gone is no item', { refs: [] }, []],
    ["another repo's branches are its own", { repo: 'other' }, []],
    ['a run still going is left to its own end', { status: 'running' }, []]
  ])('%s', async (_name, c, want) => {
    const { source, ctx, calls } = setup(c)
    const { items } = await source.list(ctx, {})
    expect(items).toEqual(want.map((w) => expect.objectContaining(w)))
    if (calls.length > 0) {
      expect(calls[0]).toEqual([
        'git',
        'update-branch',
        '/wt/a',
        '--merge',
        'true',
        '--keep-local',
        'true',
        '--to',
        want[0]?.fields['kept.branch'],
        '--dry-run',
        'true'
      ])
    }
  })

  it('holds a branch no Pilot run knows, naming it', async () => {
    const { source, ctx } = setup({ refs: [{ branch: 'pilot/ghost', head: 'def456' }] })
    const { items } = await source.list(ctx, {})
    expect(items.map((i) => [i.key, i.fields['kept.wait'], i.fields['worktree.path']])).toEqual([
      [
        'kept:ghost',
        'no Pilot run says which worktree pilot/ghost came from; merge or delete it by hand',
        ''
      ]
    ])
  })

  it('counts the runs that ended done yet left the branch, so once_per makes it due again', async () => {
    const { source, ctx, store } = setup({})
    store.runs.create({
      id: 'm1',
      automationId: 'merge-back',
      tickId: null,
      itemKey: 'kept:r1',
      itemLabel: 'pilot/r1 → a',
      worktreePath: '/wt/a',
      startedAt: 10
    })
    store.runs.update('m1', { status: 'done', finishedAt: 11 })
    const { items } = await source.list(ctx, {})
    expect(items[0]?.fields['kept.tries']).toBe(1)
  })

  it('warns, and lists nothing, when git cannot list the branches', async () => {
    const { source, ctx } = setup({ refs: null })
    expect(await source.list(ctx, {})).toEqual({
      items: [],
      warnings: ["Couldn't list the pilot/ branches in /repo"]
    })
  })

  // The store follows git, so every view says the same: kept while the branch is there, gone once it isn't.
  it.each<[string, Case, { kept?: string; keptGoneAt?: number }]>([
    ['a kept branch git still has', {}, { kept: 'pilot/r1' }],
    ['a kept branch gone from git', { refs: [] }, { kept: 'pilot/r1', keptGoneAt: 99 }],
    ["one gone from another repo's view", { repo: 'other' }, { kept: 'pilot/r1' }],
    ['a branch no env delete reported', { kept: null }, { kept: 'pilot/r1' }]
  ])('records %s', async (_name, c, env) => {
    const { source, ctx, store } = setup(c)
    await source.list(ctx, {})
    const got = store.runs.get('r1')?.env
    expect({ kept: got?.kept, keptGoneAt: got?.keptGoneAt }).toEqual({
      kept: env.kept,
      keptGoneAt: env.keptGoneAt
    })
  })

  it('reads git for-each-ref lines', () => {
    expect(keptRefsOf('pilot/a\tabc\n\npilot/b\tdef\n')).toEqual([
      { branch: 'pilot/a', head: 'abc' },
      { branch: 'pilot/b', head: 'def' }
    ])
  })

  it('ticks every kept_branch job at once with the kept run, as a handover', () => {
    const run = setup({}).store.runs.get('r1')
    if (!run) {
      throw new Error('no run r1')
    }
    const triggered: [string, TickTrigger][] = []
    triggerKeptJobs(
      [
        testDefinition({
          id: 'merge-back',
          items: { kind: 'kept_branch', where: {}, match: [], customFields: [] }
        }),
        testDefinition({ id: 'other' })
      ],
      run,
      (id, cause) => triggered.push([id, cause])
    )
    expect(triggered).toEqual([
      ['merge-back', { automationId: 'review', runId: 'r1', stage: null, ids: ['kept:r1'] }]
    ])
  })
})
