import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ItemFields, RunRow } from '../../shared/api-types'
import type { EnvWorkspaceDef } from '../../shared/definition/types'
import { PilotStore } from '../store/store'
import type { PilotcliCall, PilotcliReply } from './pilotcli'
import { createPreparations, STOPPED, type PrepareDeps, type PreparedHooks } from './prepare'

const ENV: EnvWorkspaceDef = {
  kind: 'env',
  subject: { kind: 'worktree', worktree: '{worktree.path}', at: null },
  writes: true,
  stack: 'when_backend'
}
const FIELDS: ItemFields = { 'worktree.path': '/wt/a', 'repo.path': '/repo', 'run.id': 'ci-1' }
const ok = (data: Record<string, unknown>): PilotcliReply => ({
  outcome: 'ok',
  reason: '',
  code: 0,
  data: { run: 'ci-1', reason: '', sha: 'abc', env: {}, stack: null, env_file: null, ...data }
})
const FOUND: Record<string, string> = {
  '/wt/a': 'repo::/wt/a',
  '/wt/b': 'repo::/wt/b',
  '/wt/web-1': 'repo::/wt/web-1',
  '/agents/agents-ci-1': 'repo::/agents/agents-ci-1'
}
const listed: PrepareDeps['resolvePath'] = async (_repo, path) => {
  const id = FOUND[path]
  if (!id) {
    throw new Error(`Pilot's runtime didn't list ${path} within 60s`)
  }
  return { id, path }
}

type Nested = { worktreeId: string; home: string; label: string }

function setup(
  replies: (PilotcliReply | Promise<PilotcliReply>)[],
  resolvePath = listed,
  nestThrowaway: PrepareDeps['nestThrowaway'] = async () => {}
) {
  const store = PilotStore.open(':memory:')
  store.runs.create({
    id: 'ci-1',
    automationId: 'ci',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1',
    worktreePath: null,
    startedAt: 1
  })
  const calls: PilotcliCall[] = []
  const ended: { status: string; outcome: string; release: boolean }[] = []
  const nested: Nested[] = []
  const logged: string[] = []
  let readies = 0
  const pidDir = mkdtempSync(join(tmpdir(), 'pids-'))
  const preps = createPreparations({
    runs: store.runs,
    pilotcli: async (call) => {
      calls.push(call)
      return (
        (await replies.shift()) ?? { outcome: 'failed', reason: 'no reply', data: null, code: 1 }
      )
    },
    resolvePath,
    nameOf: (id) => `${id} job`,
    pidFile: (runId) => join(pidDir, `${runId}.pid`),
    preparer: () => ({ pid: 1, identity: null }),
    nestThrowaway: async (worktreeId, home, label) => {
      nested.push({ worktreeId, home, label })
      await nestThrowaway(worktreeId, home, label)
    },
    log: (message) => logged.push(message)
  })
  const hooks: PreparedHooks = {
    ready: async () => {
      readies += 1
    },
    end: (end, opts) => ended.push({ ...end, release: opts.release === true })
  }
  const run = () => store.runs.get('ci-1') as RunRow
  const begin = (fields = FIELDS, env = ENV) =>
    preps.begin({ run: run(), env, repo: 'web-platform', label: '!1', fields }, hooks)
  return { store, calls, preps, ended, nested, logged, run, begin, readies: () => readies }
}

const NESTED_CI: Nested = {
  worktreeId: 'repo::/agents/agents-ci-1',
  home: '/wt/a',
  label: 'ci job · @abc1234'
}

describe('preparing a run’s workspace', () => {
  it.each([
    [
      'in place',
      ok({ mode: 'in_place', path: '/wt/a' }),
      { state: 'ready', mode: 'in_place', worktree: '/wt/a', home: '/wt/a', readies: 1, ended: [] }
    ],
    [
      'a throwaway: named for its job and commit, under its home',
      ok({
        mode: 'throwaway',
        reason: 'uncommitted changes',
        path: '/agents/agents-ci-1',
        sha: 'abc1234def',
        env: { API_URL: 'http://localhost:8123' }
      }),
      {
        state: 'ready',
        mode: 'throwaway',
        worktree: '/agents/agents-ci-1',
        home: '/wt/a',
        readies: 1,
        ended: [],
        nested: [NESTED_CI]
      }
    ],
    [
      'not yet',
      {
        outcome: 'not_yet',
        reason: 'the stack cap is reached (full 2 of 2)',
        data: null,
        code: 5
      } as PilotcliReply,
      {
        state: 'deferred',
        mode: null,
        worktree: '/wt/a',
        home: '/wt/a',
        readies: 0,
        ended: [
          {
            status: 'cancelled',
            outcome: 'Deferred: the stack cap is reached (full 2 of 2)',
            release: true
          }
        ]
      }
    ],
    [
      'failed',
      {
        outcome: 'failed',
        reason: 'git worktree add failed',
        data: null,
        code: 1
      } as PilotcliReply,
      {
        state: 'failed',
        mode: null,
        worktree: '/wt/a',
        home: '/wt/a',
        readies: 0,
        ended: [
          {
            status: 'failed',
            outcome: "Couldn't prepare its workspace: git worktree add failed",
            release: false
          }
        ]
      }
    ],
    [
      'a reserved variable',
      ok({ mode: 'throwaway', path: '/agents/agents-ci-1', env: { PILOT_RUN_ID: 'x' } }),
      {
        state: 'failed',
        mode: null,
        worktree: '/wt/a',
        home: '/wt/a',
        readies: 0,
        ended: [
          {
            status: 'failed',
            outcome:
              "Couldn't prepare its workspace: pilotcli env create returned a variable Pilot won't pass to steps: PILOT_RUN_ID is reserved: not PATH, IFS, HOME, ENV, BASH_ENV, SHELLOPTS, BASHOPTS, PS4, CDPATH, GLOBIGNORE, AGENT_RUN, or a name starting PILOT_, ORCA_, LD_ or DYLD_",
            release: false
          }
        ]
      }
    ],
    [
      'in place in another folder: it works there (no mode or folder is assumed)',
      ok({ mode: 'in_place', path: '/wt/b' }),
      { state: 'ready', mode: 'in_place', worktree: '/wt/b', home: '/wt/b', readies: 1, ended: [] }
    ],
    [
      'a folder the runtime never lists',
      ok({ mode: 'throwaway', path: '/agents/x' }),
      {
        state: 'failed',
        mode: null,
        worktree: '/wt/a',
        home: '/wt/a',
        readies: 0,
        ended: [
          {
            status: 'failed',
            outcome:
              "Couldn't prepare its workspace: Pilot's runtime didn't list /agents/x within 60s",
            release: false
          }
        ]
      }
    ]
  ])('%s', async (_name, reply, expected) => {
    const t = setup([reply])
    t.begin()
    await t.preps.settled()
    expect(t.run()).toMatchObject({
      worktreePath: expected.worktree,
      homePath: expected.home,
      env: { state: expected.state, mode: expected.mode }
    })
    expect(t.readies()).toBe(expected.readies)
    expect(t.ended).toEqual(expected.ended)
    expect(t.nested).toEqual('nested' in expected ? expected.nested : [])
  })

  it('a throwaway it couldn’t nest still starts its steps', async () => {
    const t = setup(
      [ok({ mode: 'throwaway', path: '/agents/agents-ci-1', sha: 'abc1234def' })],
      listed,
      async () => {
        throw new Error('selector_not_found')
      }
    )
    t.begin()
    await t.preps.settled()
    expect(t.nested).toEqual([NESTED_CI])
    expect(t.run().env).toMatchObject({ state: 'ready', mode: 'throwaway' })
    expect(t.readies()).toBe(1)
    expect(t.logged).toEqual([
      "[pilot] run ci-1: couldn't nest its throwaway under /wt/a: selector_not_found"
    ])
  })

  // Ruling P12 (§8 "the run ends, however it ends"): env delete still runs; for nothing made it answers ok, removed: [].
  it('an invalid create fails the run and leaves the env due for env delete', async () => {
    const t = setup([
      { outcome: 'invalid', reason: '--keep needs --new-branch', data: null, code: 2 }
    ])
    t.begin()
    await t.preps.settled()
    expect(t.run().env).toMatchObject({ state: 'failed', removedAt: null })
    expect(t.ended).toEqual([
      {
        status: 'failed',
        outcome: "Couldn't prepare its workspace: --keep needs --new-branch",
        release: false
      }
    ])
  })
})

describe('any mode for any subject (Contract answers 3)', () => {
  const SUBJECTS: Record<string, EnvWorkspaceDef> = {
    worktree: ENV,
    'worktree at a commit': {
      ...ENV,
      subject: { kind: 'worktree', worktree: '{worktree.path}', at: 'abc1234' }
    },
    branch: {
      kind: 'env',
      subject: { kind: 'branch', branch: 'web-1', at: 'abc1234' },
      writes: false,
      stack: 'never'
    },
    'new branch': {
      kind: 'env',
      subject: { kind: 'new_branch', newBranch: 'web-1', from: 'origin/dev', keep: false },
      writes: true,
      stack: 'never'
    },
    'new branch, keep': {
      kind: 'env',
      subject: { kind: 'new_branch', newBranch: 'web-1', from: 'origin/dev', keep: true },
      writes: false,
      stack: 'full'
    }
  }
  const FOLDER = {
    in_place: '/wt/web-1',
    throwaway: '/agents/agents-ci-1',
    kept: '/wt/web-1'
  } as const
  // The home follows the mode only: the folder itself in place or kept; the item's worktree (/wt/a) for a throwaway.
  const HOME = { in_place: '/wt/web-1', throwaway: '/wt/a', kept: '/wt/web-1' } as const
  const ROWS = Object.keys(SUBJECTS).flatMap((subject) =>
    (['in_place', 'throwaway', 'kept'] as const).map((mode) => [subject, mode] as const)
  )

  it.each(ROWS)('%s answered %s: the run works in the folder it got', async (subject, mode) => {
    const t = setup([ok({ mode, path: FOLDER[mode] })])
    t.begin(FIELDS, SUBJECTS[subject])
    await t.preps.settled()
    expect(t.run()).toMatchObject({
      worktreePath: FOLDER[mode],
      homePath: HOME[mode],
      env: { state: 'ready', mode }
    })
    expect(t.readies()).toBe(1)
    expect(t.ended).toEqual([])
  })

  it('a folder another Pilot run holds defers the run, whatever the subject', async () => {
    const t = setup([ok({ mode: 'in_place', path: '/wt/web-1' })])
    t.store.runs.create({
      id: 'm1-1',
      automationId: 'M01',
      tickId: null,
      itemKey: 'linear:WEB-1',
      itemLabel: 'WEB-1',
      worktreePath: '/wt/web-1',
      startedAt: 1
    })
    t.begin(FIELDS, SUBJECTS['new branch, keep'])
    await t.preps.settled()
    expect(t.ended).toEqual([
      {
        status: 'cancelled',
        outcome: 'Deferred: M01 job is already working in /wt/web-1 (Pilot run m1-1)',
        release: true
      }
    ])
    expect(t.run().env).toMatchObject({ state: 'deferred' })
    expect(t.readies()).toBe(0)
  })
})

describe('the hold on the item’s worktree', () => {
  it('holds it while create runs, and passes no --throwaway', () => {
    const t = setup([new Promise<PilotcliReply>(() => {})])
    t.begin()
    expect(t.run()).toMatchObject({
      worktreePath: '/wt/a',
      homePath: '/wt/a',
      env: { state: 'preparing' }
    })
    expect(t.calls[0].args).toEqual([
      'env',
      'create',
      '--run',
      'ci-1',
      '--worktree',
      '/wt/a',
      '--writes',
      'true',
      '--stack',
      'when-backend',
      '--format',
      'json'
    ])
    expect(t.preps.isPreparing('ci-1')).toBe(true)
  })

  it('a second env run on the same worktree passes --throwaway naming the first, and takes no claim', () => {
    const t = setup([new Promise<PilotcliReply>(() => {}), new Promise<PilotcliReply>(() => {})])
    t.store.runs.create({
      id: 'rv-1',
      automationId: 'review',
      tickId: null,
      itemKey: 'wt:a',
      itemLabel: 'a',
      worktreePath: '/wt/a/',
      startedAt: 1
    })
    t.begin()
    expect(t.calls[0].args).toContain('--throwaway')
    expect(t.calls[0].args).toContain('review job is already working in it (Pilot run rv-1)')
    expect(t.run().worktreePath).toBeNull()
  })

  it('a throwaway result releases the hold', async () => {
    const t = setup([ok({ mode: 'throwaway', path: '/agents/agents-ci-1' })])
    t.begin()
    await t.preps.settled()
    expect(t.store.runs.runningInWorktree('/wt/a')).toEqual([])
  })

  it('fails a run pilotcli put in place although Pilot said the worktree was taken', async () => {
    const t = setup([ok({ mode: 'in_place', path: '/wt/a' })])
    t.store.runs.create({
      id: 'rv-1',
      automationId: 'review',
      tickId: null,
      itemKey: 'wt:a',
      itemLabel: 'a',
      worktreePath: '/wt/a',
      startedAt: 1
    })
    t.begin()
    await t.preps.settled()
    expect(t.ended[0].outcome).toBe(
      "Couldn't prepare its workspace: pilotcli worked in place although Pilot said another run holds /wt/a"
    )
  })
})

describe('off the tick, and stopped', () => {
  it('begin returns before pilotcli answers', () => {
    const t = setup([new Promise<PilotcliReply>(() => {})])
    t.begin()
    expect(t.readies()).toBe(0)
    expect(t.ended).toEqual([])
  })

  it('a stop aborts create; no hook runs, and the env reads failed', async () => {
    let answer: (r: PilotcliReply) => void = () => {}
    const t = setup([new Promise<PilotcliReply>((resolve) => (answer = resolve))])
    t.begin()
    const stopped = t.preps.stop('ci-1')
    expect(t.calls[0].signal?.aborted).toBe(true)
    answer(ok({ mode: 'in_place', path: '/wt/a' }))
    await stopped
    expect(t.readies()).toBe(0)
    expect(t.ended).toEqual([])
    expect(t.run().env).toMatchObject({
      state: 'failed',
      reason: 'stopped while it was being made'
    })
    expect(t.preps.isPreparing('ci-1')).toBe(false)
  })

  // Ruling P2: create made the env, so it never stays preparing: settled failed, teardown deletes it at the run's end.
  it.each([
    ['a stop while the folder is resolved', (t: ReturnType<typeof setup>) => t.preps.stop('ci-1')],
    [
      'the run ending while the folder is resolved',
      (t: ReturnType<typeof setup>, found: () => void) => {
        t.store.runs.update('ci-1', { status: 'cancelled', finishedAt: 60 })
        found()
      }
    ]
  ])('%s: no hook runs, and the env reads failed', async (_name, cancel) => {
    const resolving = { found: null as (() => void) | null }
    const t = setup(
      [ok({ mode: 'throwaway', path: '/agents/agents-ci-1' })],
      (_repo, path, signal) =>
        new Promise((resolve, reject) => {
          resolving.found = () => resolve({ id: `repo::${path}`, path })
          signal.addEventListener('abort', () => reject(new Error(STOPPED)))
        })
    )
    t.begin()
    await vi.waitFor(() => expect(resolving.found).not.toBeNull())
    await cancel(t, () => resolving.found?.())
    await t.preps.settled()
    expect(t.readies()).toBe(0)
    expect(t.ended).toEqual([])
    expect(t.run().env).toMatchObject({ state: 'failed', reason: STOPPED, removedAt: null })
    expect(t.preps.isPreparing('ci-1')).toBe(false)
  })

  it('throws before anything starts when a subject field is missing', () => {
    const t = setup([])
    expect(() => t.begin({ 'repo.path': '/repo' })).toThrow(
      "Can't prepare the workspace for !1: {worktree.path} has no value"
    )
    expect(t.calls).toEqual([])
    expect(t.run().env).toBeNull()
  })
})

describe('a stack read from a field at run start', () => {
  const STACKED: EnvWorkspaceDef = { ...ENV, stack: { field: 'mr.stack' } }
  const stackArgs = (args: readonly string[]) =>
    args.slice(args.indexOf('--stack'), args.indexOf('--stack') + 2)

  it.each([
    ['a stack word', 'backend', ['--stack', 'backend']],
    ['the flag spelling', 'when-backend', ['--stack', 'when-backend']],
    ['the YAML spelling', 'when_backend', ['--stack', 'when-backend']]
  ])('%s: create is asked for it', (_name, value, args) => {
    const t = setup([new Promise<PilotcliReply>(() => {})])
    t.begin({ ...FIELDS, 'mr.stack': value }, STACKED)
    expect(stackArgs(t.calls[0].args)).toEqual(args)
  })

  it.each([
    ['an empty value', '', ''],
    ['no value (its script failed)', null, ''],
    ['a bad value', 'huge', 'huge']
  ])('%s: the run fails, nothing claimed, create never called', (_name, value, shown) => {
    const t = setup([])
    expect(() => t.begin({ ...FIELDS, 'mr.stack': value }, STACKED)).toThrow(
      `stack resolved to '${shown}', expected never|backend|full|when_backend`
    )
    expect(t.calls).toEqual([])
    expect(t.run()).toMatchObject({ worktreePath: null, env: null })
  })
})
