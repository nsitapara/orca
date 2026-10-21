import { describe, expect, it } from 'vitest'
import type { TickTrigger } from '../../shared/api-types-handover'
import { testDefinition } from '../../shared/definition/__fixtures__/definition'
import type { PilotcliCall, PilotcliReply } from '../envs/pilotcli'
import { PilotStore } from '../store/store'
import { sourceContext } from './__fixtures__/source-context'
import { keptBranchSource, triggerKeptJobs } from './kept-branches'

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
  branch?: string | null
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
  store.runs.update('r1', { status: 'done', finishedAt: 4 })
  store.runs.envs.removed('r1', 5, 'pilot/r1')
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
    branchTip: async () => (c.branch === undefined ? 'abc123' : c.branch)
  })
  const ctx = sourceContext(
    c.repo ? { repo: { id: 'o', name: c.repo, path: '/other', base: null } } : {}
  )
  return { store, source, ctx, calls }
}

describe('kept branch source', () => {
  it.each<[string, Case, string | null]>([
    ['a merge that can land now waits for nothing', {}, ''],
    [
      'a merge that would conflict waits for nothing: the job resolves it',
      { dryRun: reply('skip', 'conflicts in 1 file: a.ts') },
      ''
    ],
    [
      'a merge my local changes block waits with pilotcli’s reason',
      { dryRun: reply('skip', 'the merge changes 1 file you have local changes in: a.ts') },
      'the merge changes 1 file you have local changes in: a.ts'
    ],
    [
      'another Pilot run in the home worktree waits for it',
      { holder: true },
      '03 · Review is already working in /wt/a (Pilot run r2)'
    ],
    [
      'a home worktree that is gone waits for me',
      { worktrees: [] },
      'its worktree /wt/a is gone; merge or delete pilot/r1 by hand'
    ],
    ['a branch already gone is no item', { branch: null }, null],
    ["another repo's job is no item", { repo: 'other' }, null]
  ])('%s', async (_name, c, wait) => {
    const { source, ctx, calls } = setup(c)
    const { items } = await source.list(ctx, {})
    if (wait === null) {
      expect(items).toEqual([])
      return
    }
    expect(items).toEqual([
      expect.objectContaining({
        key: 'kept:r1',
        label: 'pilot/r1 → a',
        fields: {
          'kept.branch': 'pilot/r1',
          'kept.head': 'abc123',
          'kept.run': 'r1',
          'kept.job': '03 · Review',
          'kept.wait': wait,
          'worktree.path': '/wt/a'
        }
      })
    ])
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
        'pilot/r1',
        '--dry-run',
        'true'
      ])
    }
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
