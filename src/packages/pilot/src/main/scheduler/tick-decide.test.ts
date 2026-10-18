import { describe, expect, it, vi } from 'vitest'
import type { HandledRow } from '../../shared/api-types'
import { testDefinition } from '../../shared/definition/__fixtures__/definition'
import type { AutomationDefinition } from '../../shared/definition/types'
import { EMPTY_PEOPLE, parsePeopleYaml } from '../../shared/people'
import { fixture } from '../../shared/tick/__fixtures__/ci-05-2026-10-10'
import { decideTick, type HandledState } from '../../shared/tick/decide'
import { fakeFieldDeps, TEST_ENGINE_ENV, testItem } from '../fields/__fixtures__/field-deps'
import type { ActivityRuntime } from '../fields/activity-facts'
import type { FieldEngineDeps } from '../fields/engine'
import type { ScriptRequest, ScriptResult } from '../fields/script-runner'
import type { WorktreeInfo } from '../fields/worktree-facts'
import { createPassFetchCache } from '../sources/fetch-cache'
import type { IdsCommand, IdsRunner } from '../sources/ids-from'
import type { RepoFacts, SourceContext } from '../sources/types'
import { PilotStore } from '../store/store'
import {
  decideTickItems,
  handledStates,
  registrySources,
  runScriptCheck,
  type DecideDeps,
  type SourceAccess
} from './tick-decide'

const NOW = Date.UTC(2026, 9, 11, 19, 0)
const repo: RepoFacts = { name: 'web-platform', id: 'r', path: '/repo', base: 'origin/dev' }
const worktrees: WorktreeInfo[] = [
  { id: 'r::/repo', path: '/repo', branch: 'dev', head: 'h0', linkedLinearIssue: null },
  { id: 'r::/wt/1', path: '/wt/1', branch: 'b1', head: 'h1', linkedLinearIssue: null },
  { id: 'r::/wt/2', path: '/wt/2', branch: 'b2', head: 'h2', linkedLinearIssue: null }
]
const unusedGitlab = async () => {
  throw new Error('no GitLab in this test')
}
const mr = (n: number, branch: string | null, waitingSince: number | null = null) =>
  testItem({
    key: `mr:${n}`,
    label: `!${n}`,
    fields: { 'mr.iid': n },
    worktreeHint: branch ? { branch } : null,
    sortKeys: { waitingSince, priority: null }
  })
const ok = (stdout: string): ScriptResult => ({ code: 0, stdout, stderr: '', timedOut: false })

function setup(
  def: AutomationDefinition,
  over: {
    sources?: Partial<SourceAccess>
    fields?: Partial<FieldEngineDeps>
    runIds?: IdsRunner
  } = {}
) {
  const store = PilotStore.open(':memory:')
  const sources: SourceAccess = {
    list: async () => ({
      items: [mr(1, 'b1'), mr(2, 'b2'), mr(3, null)],
      warnings: ['GitLab listed 100 of 120 MRs']
    }),
    scope: (_def, item) =>
      item.key === 'mr:3' ? { verdict: 'out_of_scope', reason: 'MR is closed' } : null,
    ...over.sources
  }
  const deps: DecideDeps = {
    store,
    now: () => NOW,
    resolveRepo: async () => repo,
    sources,
    fields: fakeFieldDeps({ listWorktrees: async () => worktrees, ...over.fields }),
    ...(over.runIds ? { runIds: over.runIds } : {})
  }
  const pass = createPassFetchCache('pass-1', unusedGitlab)
  return { store, deps, decide: () => decideTickItems(def, EMPTY_PEOPLE, deps, pass, 7) }
}
const summary = (out: { decisions: { key: string; verdict: string; reason: string }[] }) =>
  out.decisions.map((d) => [d.key, d.verdict, d.reason])

describe('decideTickItems', () => {
  it('fills fields, scopes, runs custom fields only in scope, decides, and returns warnings', async () => {
    const def = testDefinition({
      id: 'a',
      items: {
        kind: 'merge_request',
        where: {},
        match: ['{mr.score} > 1'],
        customFields: [
          { name: 'score', script: './fields/score.sh', cache: 'per_tick', timeoutMs: 1000 }
        ]
      },
      checks: [{ kind: 'worktree_exists' }]
    })
    const runScript = vi.fn(async (req: ScriptRequest) =>
      ok(req.env.PILOT_ITEM_KEY === 'mr:1' ? '5' : '0')
    )
    const { decide } = setup(def, { fields: { runScript } })
    const out = await decide()
    expect(summary(out)).toEqual([
      ['mr:1', 'started', 'All checks pass'],
      ['mr:2', 'out_of_scope', 'Doesn\'t match "{mr.score} > 1"'],
      ['mr:3', 'out_of_scope', 'MR is closed']
    ])
    expect(runScript.mock.calls.map(([req]) => req.env.PILOT_ITEM_KEY)).toEqual(['mr:1', 'mr:2'])
    expect(out.warnings).toEqual(['GitLab listed 100 of 120 MRs'])
    // G3: every item carries the run-scoped names, with the tick id known (the tick row starts first).
    expect(out.decisions[0].fields).toMatchObject({ 'run.automation': 'a', 'run.tick': 7 })
  })

  it('runs a script check only for items that reach it, after the earlier checks pass', async () => {
    const def = testDefinition({
      id: 'a',
      file: '/auto/a.yaml',
      oncePer: '{mr.iid}',
      checks: [
        { kind: 'worktree_exists' },
        { kind: 'script', run: './check.sh --quiet', timeoutMs: 5000 }
      ]
    })
    const runScript = vi.fn(async (_req: ScriptRequest) => ({
      code: 1,
      stdout: 'checking\nnot today\n',
      stderr: '',
      timedOut: false
    }))
    const { store, decide } = setup(def, {
      sources: {
        list: async () => ({ items: [mr(1, 'b1'), mr(2, 'b2'), mr(4, 'gone')], warnings: [] }),
        scope: () => null
      },
      fields: { runScript }
    })
    store.markHandled('a', '2', 'run-old', 1)
    expect(summary(await decide())).toEqual([
      ['mr:1', 'skipped', 'not today'],
      ['mr:2', 'notdue', 'Already handled 2'],
      ['mr:4', 'skipped', 'No worktree for !4']
    ])
    expect(runScript).toHaveBeenCalledTimes(1)
    expect(runScript.mock.calls[0][0]).toMatchObject({
      command: "'/auto/check.sh' --quiet",
      cwd: '/repo',
      timeoutMs: 5000,
      env: {
        PATH: expect.stringMatching(/^\/pilot\/bin:/),
        ORCA_USER_DATA_PATH: '/pilot/data',
        PILOT_AUTOMATION_ID: 'a',
        PILOT_ITEM_KEY: 'mr:1',
        PILOT_WORKTREE_PATH: '/wt/1'
      }
    })
  })

  it("skips an item a field script says isn't due (exit 3), with its last line, before its script checks", async () => {
    const def = testDefinition({
      id: 'a',
      file: '/auto/a.yaml',
      items: {
        kind: 'merge_request',
        where: {},
        match: [],
        customFields: [{ name: 'stack', script: './stack.sh', cache: 'per_head', timeoutMs: 1000 }]
      },
      checks: [{ kind: 'script', run: './check.sh', timeoutMs: 5000 }]
    })
    const notYet: ScriptResult = {
      code: 3,
      stdout: 'pipeline still running\n',
      stderr: '',
      timedOut: false
    }
    const runScript = vi.fn(async (req: ScriptRequest) => {
      if (req.env.PILOT_FIELD === 'mr.stack' && req.env.PILOT_ITEM_KEY === 'mr:1') {
        return notYet
      }
      return ok('backend')
    })
    const { decide } = setup(def, {
      sources: {
        list: async () => ({ items: [mr(1, 'b1'), mr(2, 'b2')], warnings: [] }),
        scope: () => null
      },
      fields: { runScript }
    })
    const out = await decide()
    expect(summary(out)).toEqual([
      ['mr:1', 'skipped', 'pipeline still running'],
      ['mr:2', 'started', 'All checks pass']
    ])
    expect(out.warnings).toEqual([])
    const checks = runScript.mock.calls.filter(([r]) => r.env.PILOT_FIELD === undefined)
    expect(checks.map(([r]) => r.env.PILOT_ITEM_KEY)).toEqual(['mr:2'])
  })

  it("skips an item whose worktree has another automation's run", async () => {
    const def = testDefinition({ id: 'a' })
    const { store, decide } = setup(def, { sources: { scope: () => null } })
    store.runs.create({
      id: 'other-1',
      automationId: 'other',
      tickId: null,
      itemKey: 'x',
      itemLabel: 'x',
      worktreePath: '/wt/1',
      startedAt: 1
    })
    const out = await decide()
    expect(out.decisions[0]).toMatchObject({
      key: 'mr:1',
      verdict: 'skipped',
      reason: 'Another run is active in /wt/1'
    })
  })

  // G2/B2: a main_checkout run records the repo path as its worktree, but the main checkout is shared.
  // Orca's worktree list may spell the main checkout differently from its repo list.
  it.each(['/repo', '/repo/'])(
    "doesn't count the repo's main checkout as busy (listed as %s)",
    async (listed) => {
      const def = testDefinition({ id: 'a' })
      const main = { ...worktrees[0], path: listed }
      const { store, decide } = setup(def, {
        sources: { list: async () => ({ items: [mr(5, 'dev')], warnings: [] }), scope: () => null },
        fields: { listWorktrees: async () => [main, ...worktrees.slice(1)] }
      })
      store.runs.create({
        id: 'other-1',
        automationId: 'other',
        tickId: null,
        itemKey: 'x',
        itemLabel: 'x',
        worktreePath: listed,
        startedAt: 1
      })
      const out = await decide()
      expect(out.decisions[0]).toMatchObject({ key: 'mr:5', verdict: 'started' })
    }
  )

  it.each([
    ['first seen counts as waiting when the source has no time', 10, 'mr:1'],
    ["the source's own waiting time wins", 100, 'mr:2']
  ])('orders oldest_waiting_first: %s', async (_name, seenAt, first) => {
    const def = testDefinition({
      id: 'a',
      limits: { perTick: 1, atOnce: null, timeoutMs: null, order: 'oldest_waiting_first' }
    })
    const { store, decide } = setup(def, {
      sources: {
        list: async () => ({ items: [mr(1, 'b1'), mr(2, 'b2', 50)], warnings: [] }),
        scope: () => null
      }
    })
    store.markSeen('a', 'mr:1', seenAt)
    const out = await decide()
    expect(out.decisions.find((d) => d.verdict === 'started')?.key).toBe(first)
  })

  // The handled rows reach the decision as they are: a failed run's key retries, a seeded one never does.
  it('retries a key whose run failed once retry_after_failure has passed, but not a key no run holds', async () => {
    const def = testDefinition({ id: 'a', oncePer: '{mr.iid}', retryAfterFailureMs: 60 * 60_000 })
    const { store, decide } = setup(def, {
      sources: {
        list: async () => ({ items: [mr(1, 'b1'), mr(2, 'b2')], warnings: [] }),
        scope: () => null
      }
    })
    store.markHandled('a', '1', 'run-1', 1)
    store.setHandledStatus('a', 'run-1', 'failed', NOW - 2 * 60 * 60_000)
    store.markHandled('a', '2', null, 1)
    expect(summary(await decide())).toEqual([
      ['mr:1', 'started', 'All checks pass'],
      ['mr:2', 'notdue', 'Already handled 2']
    ])
  })

  it('runs the activity pre-pass for a worktree: idle check, and only then', async () => {
    const def = testDefinition({ id: 'a', checks: [{ kind: 'worktree_idle' }] })
    const terminals = vi.fn(async () => [
      {
        handle: 't1',
        title: 'Fix',
        connected: true,
        agentIdentity: 'claude',
        worktreePath: '/wt/1',
        tabId: 'x',
        leafId: 'l'
      }
    ])
    const activity: ActivityRuntime = {
      terminals,
      reads: () => ({
        draft: async () => 'half a prompt',
        agentStates: async () => new Map(),
        tabBusy: async () => false
      }),
      terminalAlive: async () => false
    }
    const { deps } = setup(def)
    const pass = createPassFetchCache('pass-1', unusedGitlab)
    const out = await decideTickItems(def, EMPTY_PEOPLE, { ...deps, activity }, pass, 7)
    expect(summary(out)).toEqual([
      ['mr:1', 'skipped', 'someone is typing in Fix'],
      ['mr:2', 'started', 'All checks pass'],
      ['mr:3', 'out_of_scope', 'MR is closed']
    ])
    await decideTickItems(
      testDefinition({ id: 'a', checks: [] }),
      EMPTY_PEOPLE,
      { ...deps, activity },
      pass,
      7
    )
    expect(terminals).toHaveBeenCalledTimes(1)
  })

  it('fails when the source fails, so the tick is recorded failed', async () => {
    const { decide } = setup(testDefinition(), {
      sources: {
        list: async () => {
          throw new Error('glab: 502 Bad Gateway')
        }
      }
    })
    await expect(decide()).rejects.toThrow('glab: 502 Bad Gateway')
  })
})

describe('decideTickItems: where.ids_from', () => {
  const tickets = (where: Record<string, unknown>) =>
    testDefinition({
      id: 'starts',
      file: '/autos/starts.yaml',
      items: { kind: 'linear_ticket', where, match: [], customFields: [] }
    })
  const listing = () => {
    const seen: (readonly string[] | null | undefined)[] = []
    const list: SourceAccess['list'] = async (_def, ctx) => {
      seen.push(ctx.ids)
      return { items: [], warnings: [] }
    }
    return { seen, list }
  }
  const answering = (code: number, stdout: string) => {
    const calls: IdsCommand[] = []
    const run: IdsRunner = async (cmd) => {
      calls.push(cmd)
      return {
        code,
        stdout,
        stderr: code === 0 || code === 3 ? '' : 'Traceback\nOSError: boom',
        timedOut: false,
        truncated: false
      }
    }
    return { calls, run }
  }
  const IDS_FROM = { run: 'python3 /s/pilot_mode.py list-fix-tickets', field: 'identifier' }

  it('runs the command once, in the main checkout, and hands the source its ids instead of a listing', async () => {
    const { seen, list } = listing()
    const ids = answering(0, '{"v":1,"data":[{"identifier":"WEB-2"},{"identifier":"WEB-1"}]}')
    const { decide } = setup(tickets({ ids_from: IDS_FROM, team: 'WEB' }), {
      sources: { list },
      runIds: ids.run
    })
    await decide()
    expect(seen).toEqual([['WEB-2', 'WEB-1']])
    expect(ids.calls).toHaveLength(1)
    expect(ids.calls[0]).toMatchObject({
      program: 'python3',
      args: ['/s/pilot_mode.py', 'list-fix-tickets'],
      cwd: '/repo'
    })
    expect(ids.calls[0].env).toMatchObject({ PILOT_AUTOMATION_ID: 'starts' })
  })

  it('hands an empty set on exit 3, and no ids at all to a source without ids_from', async () => {
    const empty = listing()
    await setup(tickets({ ids_from: IDS_FROM }), {
      sources: { list: empty.list },
      runIds: answering(3, '').run
    }).decide()
    expect(empty.seen).toEqual([[]])
    const plain = listing()
    const never = answering(0, '[]')
    await setup(tickets({ team: 'WEB' }), {
      sources: { list: plain.list },
      runIds: never.run
    }).decide()
    expect(plain.seen).toEqual([null])
    expect(never.calls).toEqual([])
  })

  it('reads a fed id only when the stage’s own command lists it too; the rest wait, pending', async () => {
    const { seen, list } = listing()
    const ids = answering(0, '{"v":1,"data":[{"identifier":"web-1"},{"identifier":"WEB-3"}]}')
    const { store, decide } = setup(tickets({ ids_from: { feed: true, ...IDS_FROM } }), {
      sources: { list },
      runIds: ids.run
    })
    store.handovers.add({
      senderId: 'pipelines',
      senderRunId: 'r1',
      receiverId: 'starts',
      itemIds: ['WEB-2', 'WEB-1'],
      at: NOW
    })
    store.handovers.add({
      senderId: 'pipelines',
      senderRunId: 'r1',
      receiverId: 'other',
      itemIds: ['X-9'],
      at: NOW
    })
    const out = await decide()
    expect(seen).toEqual([['WEB-1', 'WEB-3']])
    expect(out.fed.map((h) => h.itemId)).toEqual(['WEB-1'])
    expect(out.dropped).toEqual([])
    expect(out.warnings).toContain(
      "WEB-2 was handed over but isn't in the stage's own list yet; it waits (at most 7 days)"
    )
    expect(ids.calls).toHaveLength(1)
  })

  it('reads only what it is fed when ids_from has no command, and an empty set when nothing is pending', async () => {
    const { seen, list } = listing()
    const never = answering(0, '[]')
    const { store, decide } = setup(tickets({ ids_from: { feed: true } }), {
      sources: { list },
      runIds: never.run
    })
    expect((await decide()).fed).toEqual([])
    store.handovers.add({
      senderId: 'p',
      senderRunId: 'r1',
      receiverId: 'starts',
      itemIds: ['WEB-7'],
      at: NOW
    })
    await decide()
    expect(seen).toEqual([[], ['WEB-7']])
    expect(never.calls).toEqual([])
  })

  it('fails the tick, listing nothing, when the command fails', async () => {
    const { seen, list } = listing()
    const { decide } = setup(tickets({ ids_from: IDS_FROM }), {
      sources: { list },
      runIds: answering(1, '').run
    })
    await expect(decide()).rejects.toThrow('ids_from exited 1: OSError: boom')
    expect(seen).toEqual([])
  })
})

describe('handledStates', () => {
  // Seeded and baselined keys (run_id NULL) never become retryable, whatever their row says, except an old sweep's
  // failure the retired sweep-state import brought in with its time (04's failed.json): it waits retry_after_failure
  // from that time.
  it("reads each key's status, and a key no run holds as started unless it is an imported failure", () => {
    const row = (
      onceKey: string,
      runId: string | null,
      status: HandledRow['status'],
      failedAt: number | null
    ): HandledRow => ({ onceKey, runId, at: 1, status, failedAt })
    expect(
      handledStates([
        row('1', 'run-1', 'failed', 50),
        row('2', 'run-2', 'done', null),
        row('3', 'run-3', 'started', null),
        row('4', null, 'failed', 50),
        row('5', null, 'started', null),
        row('6', null, 'failed', null),
        row('7', null, 'done', null)
      ])
    ).toEqual(
      new Map<string, HandledState>([
        ['1', { status: 'failed', failedAt: 50 }],
        ['2', { status: 'done', failedAt: null }],
        ['3', { status: 'started', failedAt: null }],
        ['4', { status: 'failed', failedAt: 50 }],
        ['5', { status: 'started', failedAt: null }],
        ['6', { status: 'started', failedAt: null }],
        ['7', { status: 'started', failedAt: null }]
      ])
    )
  })
})

describe('registrySources', () => {
  it("lists a run-once automation's one item: the repo", async () => {
    const ctx: SourceContext = {
      repo,
      people: EMPTY_PEOPLE,
      fetch: createPassFetchCache('pass-1', unusedGitlab),
      now: NOW,
      automationId: 'pull-dev'
    }
    const listed = await registrySources.list(testDefinition({ items: null }), ctx)
    expect(listed).toMatchObject({
      items: [{ kind: 'repo', key: 'repo:web-platform' }],
      warnings: []
    })
  })
})

describe('runScriptCheck', () => {
  const check = { kind: 'script' as const, run: '/bin/gate', timeoutMs: 2000 }
  const def = testDefinition({ id: 'a' })
  it.each<[string, ScriptResult | Error, boolean, string]>([
    ['passes on exit 0 with its last line', ok('one\nready to go\n'), true, 'ready to go'],
    ['passes quietly', ok(''), true, 'The check passed'],
    [
      'fails with its last line',
      { code: 1, stdout: '', stderr: 'no memo\n', timedOut: false },
      false,
      'no memo'
    ],
    [
      'fails quietly',
      { code: 4, stdout: '', stderr: '', timedOut: false },
      false,
      'The check exited 4'
    ],
    [
      'times out',
      { code: null, stdout: '', stderr: '', timedOut: true },
      false,
      'The check timed out after 2s'
    ],
    ["can't start", new Error('spawn ENOENT'), false, "The check couldn't start: spawn ENOENT"]
  ])('%s', async (_name, result, passed, reason) => {
    const run = async () => {
      if (result instanceof Error) {
        throw result
      }
      return result
    }
    expect(await runScriptCheck(check, testItem(), def, repo, run, TEST_ENGINE_ENV)).toEqual({
      ok: passed,
      reason
    })
  })
})

describe('05 on 2026-10-10 12:10 through the merge-request source and decideTick v2', () => {
  it('matches what the old sweep decided, item by item', () => {
    const people = parsePeopleYaml(
      'people:\n  - { id: nish, name: Nish Sitapara, gitlab: nish8 }\n  - { id: shivan, name: Shivan, gitlab: shivan2418 }\n'
    )
    if (!people.ok) {
      throw new Error('setup')
    }
    const def = testDefinition({
      id: 'fix-failed-ci',
      name: 'Fix failed CI on my MRs',
      items: {
        kind: 'merge_request',
        where: { state: 'open', author: { people: ['nish'] }, head_pipeline: 'failed' },
        match: [],
        customFields: []
      },
      oncePer: '{mr.iid}:{mr.pipeline}',
      checks: [
        { kind: 'worktree_exists' },
        { kind: 'worktree_clean' },
        { kind: 'session_none_open', scope: 'automation' },
        { kind: 'quota', agent: 'claude', weekly: 90, session: 95 }
      ],
      limits: { perTick: 3, atOnce: null, timeoutMs: null, order: 'listed' }
    })
    // M1 counted untracked files in dirty_count; v2 reads them apart.
    const items = fixture.items.map((i) =>
      testItem({
        key: i.key,
        label: i.label,
        fields: {
          ...i.fields,
          'worktree.untracked_count': i.fields['worktree.path'] === null ? null : 0
        }
      })
    )
    const scope = new Map(
      items.flatMap((item) => {
        const gate = registrySources.scope(def, item, people.directory)
        return gate ? [[item.key, gate] as const] : []
      })
    )
    const handled = new Map<string, HandledState>(
      fixture.handledKeys.map((k) => [k, { status: 'started', failedAt: null }])
    )
    const decisions = decideTick({
      definition: def,
      items,
      now: Date.UTC(2026, 9, 10, 19, 10),
      scope,
      handled,
      seenKeys: new Set(),
      activeRuns: 0,
      busyWorktrees: new Set(),
      scriptChecks: new Map()
    })
    expect(decisions.map((d) => [d.key, d.verdict, d.reason])).toEqual([
      ['!1561', 'started', 'All checks pass'],
      ['!1587', 'notdue', 'Already handled 1587:2933991087'],
      ['!1574', 'skipped', '2 uncommitted files'],
      ['!1592', 'skipped', 'A session from this automation is still open there'],
      ['!1347', 'notdue', 'Head pipeline success'],
      ['!1590', 'notdue', 'Head pipeline running'],
      ['!1588', 'out_of_scope', 'Author is Shivan; this automation looks at Nish Sitapara'],
      ['!1600', 'out_of_scope', "Author contractor9 isn't in people.yaml"]
    ])
    expect(decisions[0].onceKey).toBe('1561:2934410022')
  })
})
