import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { EnvMode } from '../../shared/api-types-env'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { EnvWorkspaceDef } from '../../shared/definition/types'
import { createPreparations, type PrepareRequest, type PreparedHooks } from '../envs/prepare'
import { UnrecordedLaunchError } from '../scheduler/tick-runner'
import { PilotStore } from '../store/store'
import { FREE_HOLDS } from './__fixtures__/holds'
import { answerEnvOf } from './answer-env'
import { dispatchToAgent, type AgentDispatchDeps } from './answer-run'
import { answersHold } from './holds'

const YAML = (workspace: string) =>
  `name: Fix CI\nrepo: web-platform\nschedule: manual\nitems: { kind: merge_request }\n${workspace}` +
  'steps: [ { agent: claude, skill: fix-gitlab-ci, prompt: x } ]\n' +
  'answers: { resume: asking_session, else: { agent: claude, skill: fix-gitlab-ci, mode: answers } }\ninbox: nish\n'
function definition(workspace: string) {
  const parsed = parseAutomationYaml(YAML(workspace), '/a/ci.yaml')
  if (!parsed.ok) {
    throw new Error(parsed.errors.join('\n'))
  }
  return parsed.definition
}
const ENV_DEF = definition(
  'workspace: { env: { worktree: "{worktree.path}", stack: when_backend } }\n'
)
const PLAIN_DEF = definition('')
const NOW = 1_800_000_000_000
const SESSION = '00000000-0000-4000-8000-000000000001'
const VARS = { COMPOSE_PROJECT_NAME: 'agents-ci-answer' }

// The asking run worked in place in /wt/a; its tab term-1 is free and holds the session. Its card is answered and queued.
function setup() {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-answer-env-')), 'db.sqlite'))
  store.runs.create({
    id: 'run-1',
    automationId: 'ci',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1',
    worktreePath: '/wt/a',
    startedAt: 1
  })
  store.runs.createStep({
    runId: 'run-1',
    idx: 0,
    name: 'fix',
    agent: 'claude',
    skill: 'fix-gitlab-ci',
    startedAt: 1
  })
  store.runs.updateStep('run-1', 0, {
    status: 'done',
    terminalHandle: 'term-1',
    paneKey: 'tab:leaf',
    sessionId: SESSION,
    launchArgs: []
  })
  store.runs.update('run-1', { status: 'needs_you', finishedAt: 2 })
  store.inbox.add({
    id: 'in_a',
    automationId: 'ci',
    runId: 'run-1',
    stepIdx: 0,
    itemKey: 'mr:1',
    worktreePath: '/wt/a',
    person: 'nish',
    type: 'question',
    title: 'Push it?',
    context: 'CI is green on the fix',
    options: [],
    suggested: null,
    detailsMd: null,
    action: null,
    actionArgs: null,
    digest: 'd1',
    createdAt: 5,
    source: 'engine',
    vaultRef: null
  })
  store.inbox.saveAnswer(
    'in_a',
    { option: null, text: 'yes', digest: 'd1', via: 'page' },
    'nish',
    6
  )
  const rowId = store.queue.enqueue('in_a', 0, 6)
  const begun: { req: PrepareRequest; hooks: PreparedHooks }[] = []
  const closed: { status: string; outcome: string }[] = []
  const handedBack: string[] = []
  const deps: AgentDispatchDeps = {
    store,
    now: () => NOW,
    probe: {
      terminalState: async () => 'free',
      transcript: async () => ({ size: 10, mtimeMs: NOW })
    },
    quota: async () => ({ weekly: 10, session: 10 }),
    open: vi.fn().mockResolvedValue({
      terminalHandle: 'term-2',
      paneKey: 'tab2:leaf',
      sessionId: '00000000-0000-4000-8000-000000000002'
    }),
    send: vi.fn().mockResolvedValue(undefined),
    mainCheckout: async () => '/main',
    current: (item) => item,
    fileExists: () => true,
    warn: () => {},
    envs: {
      preparer: {
        begin: (req, hooks) => {
          begun.push({ req, hooks })
        },
        isPreparing: () => begun.length > 0
      },
      close: (run, end) => {
        closed.push(end)
        store.runs.update(run.id, {
          status: end.status,
          outcome: end.outcome,
          finishedAt: NOW
        })
      },
      handBack: (ids) => {
        handedBack.push(...ids)
      }
    }
  }
  const item = store.inbox.get('in_a')!
  const group = {
    def: ENV_DEF,
    worktreePath: '/wt/a' as string | null,
    rowId,
    answers: [{ item, revise: false, needsAgent: null }]
  }
  return { store, deps, group, rowId, begun, closed, handedBack }
}

// dispatchToAgent, then what the dispatcher does with a dispatch: mark the rows sent, then afterSent.
async function dispatched(t: ReturnType<typeof setup>) {
  const sent = await dispatchToAgent(t.deps, t.group)
  if (sent.kind !== 'dispatched' || !sent.afterSent) {
    throw new Error(`expected a dispatch with afterSent, got ${sent.kind}`)
  }
  expect(t.begun).toEqual([])
  t.store.queue.update(
    t.rowId,
    { state: 'dispatched', dispatchedRunId: sent.runId, route: sent.route },
    NOW
  )
  sent.afterSent()
  return sent
}

// The answer run's env came back ready in `folder`, then the preparer's ready hook runs.
async function readyIn(
  t: ReturnType<typeof setup>,
  runId: string,
  mode: EnvMode,
  folder: string,
  home: string
) {
  t.store.runs.envs.begin(runId, '/wt/a', {})
  t.store.runs.envs.ready(runId, {
    mode,
    reason: '',
    path: folder,
    home,
    worktreeId: `repo::${folder}`,
    sha: null,
    envFile: null,
    vars: VARS,
    stack: null
  })
  await t.begun[0].hooks.ready()
}

describe("answerEnvOf: the job's env, with writes", () => {
  const job = (env: EnvWorkspaceDef) => ({ name: 'Job', workspace: env })
  const branch: EnvWorkspaceDef = {
    kind: 'env',
    subject: { kind: 'branch', branch: '{mr.branch}', at: '{mr.head_sha}' },
    writes: false,
    stack: 'never'
  }
  const newBranch: EnvWorkspaceDef = {
    kind: 'env',
    subject: {
      kind: 'new_branch',
      newBranch: '{ticket.branch}',
      from: 'origin/dev',
      keep: true
    },
    writes: false,
    stack: 'full'
  }
  const worktree = (path: string, stack: EnvWorkspaceDef['stack']): EnvWorkspaceDef => ({
    kind: 'env',
    subject: { kind: 'worktree', worktree: path, at: null },
    writes: true,
    stack
  })
  it.each([
    [
      "a worktree subject: the card's worktree",
      ENV_DEF.workspace as EnvWorkspaceDef,
      '/wt/a',
      null,
      worktree('/wt/a', 'when_backend')
    ],
    [
      'a branch the asking run threw away: the job’s own subject',
      branch,
      '/repo',
      { homePath: '/repo', mode: 'throwaway' },
      { ...branch, writes: true }
    ],
    [
      'a branch the asking run worked on in place: that worktree',
      branch,
      '/repo',
      { homePath: '/wt/web-9', mode: 'in_place' },
      worktree('/wt/web-9', 'never')
    ],
    [
      'a kept new branch: its worktree now',
      newBranch,
      '/wt/web-1',
      { homePath: '/wt/web-1', mode: 'kept' },
      worktree('/wt/web-1', 'full')
    ],
    [
      'a new branch the asking run threw away: the job’s own subject (pilotcli finds the branch)',
      newBranch,
      '/repo',
      { homePath: '/repo', mode: 'throwaway' },
      { ...newBranch, writes: true }
    ]
  ] as const)('%s', (_name, env, home, asking, expected) => {
    expect(answerEnvOf(job(env), home, asking)).toEqual(expected)
  })
})

describe('answerEnvOf: answers.stack never', () => {
  const full: EnvWorkspaceDef = {
    kind: 'env',
    subject: {
      kind: 'new_branch',
      newBranch: '{t.branch}',
      from: 'origin/dev',
      keep: true
    },
    writes: false,
    stack: 'full'
  }
  it.each([
    [
      'a free worktree',
      { ...full, subject: { kind: 'worktree', worktree: '/wt/a', at: null } },
      '/wt/a',
      null
    ],
    ['a throwaway', full, '/repo', { homePath: '/repo', mode: 'throwaway' }],
    ['a kept folder', full, '/wt/b', { homePath: '/wt/b', mode: 'kept' }]
  ] as const)('%s keeps its env rules and starts no stack', (_n, env, home, asking) => {
    const kept = answerEnvOf({ name: 'Job', workspace: env }, home, asking)
    const never = answerEnvOf(
      { name: 'Job', workspace: env, answers: { stack: 'never' } },
      home,
      asking
    )
    expect(kept.stack).toBe('full')
    expect(never).toEqual({ ...kept, stack: 'never' })
  })
})

describe('an answer run in an env', () => {
  it("is dispatched at once, then prepared once its rows read sent: the job's env with writes, in the card's worktree", async () => {
    const t = setup()
    const sent = await dispatched(t)
    expect(sent).toMatchObject({
      kind: 'dispatched',
      route: 'resume',
      sessionId: null
    })
    expect(t.begun[0].req.env).toEqual({
      kind: 'env',
      subject: { kind: 'worktree', worktree: '/wt/a', at: null },
      writes: true,
      stack: 'when_backend'
    })
    expect(t.store.runs.steps(sent.runId)[0].status).toBe('pending')
  })

  it.each([
    [
      "in the asking session's own folder: its tab gets the answers",
      'in_place',
      '/wt/a',
      '/wt/a',
      'resume'
    ],
    [
      'in a throwaway: a fresh session in that folder, with its variables',
      'throwaway',
      '/agents/agents-ci-answer',
      '/wt/a',
      'new'
    ],
    ['in place in another worktree: a fresh session there', 'in_place', '/wt/b', '/wt/b', 'new']
  ] as const)('%s', async (_name, mode, folder, home, route) => {
    const t = setup()
    const sent = await dispatched(t)
    await readyIn(t, sent.runId, mode, folder, home)
    if (route === 'resume') {
      expect(vi.mocked(t.deps.send).mock.calls[0][0]).toBe('term-1')
      expect(t.deps.open).not.toHaveBeenCalled()
    } else {
      expect(vi.mocked(t.deps.open).mock.calls[0][0]).toMatchObject({
        worktree: { path: folder },
        runEnv: VARS
      })
      expect(t.deps.send).not.toHaveBeenCalled()
      // Away from the asking session (whose checkout is still there): the fresh session gets what each card said.
      const prompt = vi.mocked(t.deps.open).mock.calls[0][0].prompt
      expect(prompt).toContain(
        'The asking session worked in another checkout. What its cards said:'
      )
      expect(prompt).toContain('[in_a] "CI is green on the fix"')
      // Step 0 says what launched: the fresh session's answers mode, not the asking session it was planned on.
      expect(t.store.runs.steps(sent.runId)[0]).toMatchObject({
        status: 'running',
        mode: 'answers'
      })
    }
    expect(t.store.queue.get(t.rowId)?.route).toBe(route)
  })

  it.each([
    [
      'deferred: held, waits, no try counted',
      { status: 'cancelled', outcome: 'Deferred: the stack cap is reached' },
      {
        state: 'held',
        holdReason: 'waits',
        attempts: 0,
        dispatchedRunId: null
      },
      'skipped'
    ],
    [
      'create failed: held, retry, a try counted',
      {
        status: 'failed',
        outcome: "Couldn't prepare its workspace: git failed"
      },
      {
        state: 'held',
        holdReason: 'retry',
        attempts: 1,
        dispatchedRunId: null
      },
      'failed'
    ]
  ] as const)('%s', async (_name, end, row, step0) => {
    const t = setup()
    const sent = await dispatched(t)
    t.begun[0].hooks.end(end, { release: end.status === 'cancelled' })
    expect(t.store.queue.get(t.rowId)).toMatchObject(row)
    expect(t.closed).toEqual([end])
    expect(t.store.inbox.get('in_a')?.status).toBe('answered')
    // Ruling P10: step 0 settles as the engine's env runs' does (envHooks.end), never left pending.
    expect(t.store.runs.steps(sent.runId)[0]).toMatchObject({
      status: step0,
      error: end.outcome
    })
  })

  it("an env that can't even be asked for fails the run and its step 0, and the answers retry", async () => {
    const t = setup()
    t.deps.envs!.preparer.begin = () => {
      throw new Error("stack resolved to '', expected never|backend|full|when_backend")
    }
    const sent = await dispatched(t)
    expect(t.closed.map((c) => c.status)).toEqual(['failed'])
    expect(t.store.runs.steps(sent.runId)[0]).toMatchObject({
      status: 'failed'
    })
    expect(t.store.queue.get(t.rowId)).toMatchObject({
      state: 'held',
      holdReason: 'retry',
      attempts: 1
    })
  })

  it.each([
    [
      "a launch that couldn't start: the run fails, the answers retry",
      new Error('no pty'),
      { state: 'held', holdReason: 'retry', attempts: 1 },
      []
    ],
    [
      'a launch nothing can follow: the cards go back to their person',
      new UnrecordedLaunchError('term-9', 'no pane'),
      { state: 'dispatched' },
      ['in_a']
    ]
  ] as const)('%s', async (_name, error, row, handedBack) => {
    const t = setup()
    vi.mocked(t.deps.open).mockRejectedValueOnce(error)
    const sent = await dispatched(t)
    await readyIn(t, sent.runId, 'throwaway', '/agents/agents-ci-answer', '/wt/a')
    expect(t.store.runs.get(sent.runId)?.status).toBe('failed')
    expect(t.store.queue.get(t.rowId)).toMatchObject(row)
    expect(t.handedBack).toEqual(handedBack)
  })
})

// Ruling P10: the run claims its worktree only through begin's claimHome, so one that gets --throwaway never holds /wt/a.
describe('an env answer run claims no worktree from its creation', () => {
  it.each([
    ['nobody works in /wt/a: begin claims it', false, '/wt/a', null],
    [
      'another Pilot run works in /wt/a: --throwaway, and no claim',
      true,
      null,
      'Review is already working in it (Pilot run rv-1)'
    ]
  ] as const)('%s', async (_name, busy, claimed, throwaway) => {
    const t = setup()
    if (busy) {
      t.store.runs.create({
        id: 'rv-1',
        automationId: 'review',
        tickId: null,
        itemKey: 'mr:1',
        itemLabel: '!1',
        worktreePath: '/wt/a',
        startedAt: 3
      })
    }
    const asked: (readonly string[])[] = []
    t.deps.envs!.preparer = createPreparations({
      runs: t.store.runs,
      // Never answers: only what create was asked matters here.
      pilotcli: (call) => {
        asked.push(call.args)
        return new Promise(() => {})
      },
      resolvePath: async (_repo, path) => ({ id: 'id', path }),
      nameOf: (id) => (id === 'review' ? 'Review' : id),
      pidFile: (runId) => join(tmpdir(), `${runId}.pid`),
      preparer: () => ({ pid: process.pid, identity: null }),
      log: () => {}
    })
    const sent = await dispatchToAgent(t.deps, t.group)
    if (sent.kind !== 'dispatched' || !sent.afterSent) {
      throw new Error(`expected a dispatch, got ${sent.kind}`)
    }
    expect(t.store.runs.get(sent.runId)?.worktreePath).toBeNull()
    sent.afterSent()
    expect(t.store.runs.get(sent.runId)?.worktreePath ?? null).toBe(claimed)
    const at = asked[0].indexOf('--throwaway')
    expect(at === -1 ? null : asked[0][at + 1]).toBe(throwaway)
  })
})

describe('answersHold', () => {
  const holds = (exists: boolean, busy: boolean) => ({
    ...FREE_HOLDS,
    exists: () => exists,
    runsIn: () => (busy ? [{ id: 'rv-1' }] : [])
  })
  it.each([
    [
      'an env automation, a Pilot run working there: no hold (pilotcli gets --throwaway)',
      ENV_DEF,
      true,
      true,
      null
    ],
    ['an env automation, its worktree gone: no_worktree', ENV_DEF, false, false, 'no_worktree'],
    [
      'any other automation, a Pilot run working there: worktree_busy, as today',
      PLAIN_DEF,
      true,
      true,
      'worktree_busy'
    ]
  ] as const)('%s', async (_name, def, exists, busy, code) => {
    const held = await answersHold(def, '/wt/a', holds(exists, busy))
    expect(held?.holdReason ?? null).toBe(code)
  })
})
