import { describe, expect, it, vi } from 'vitest'
import type { RunRow, StepRow } from '../../shared/api-types'
import type { EnvMode, RunEnv } from '../../shared/api-types-env'
import type { SessionTerminalState } from './agent-step'
import { judgeClaim, SessionClaims } from './session-claims'
import {
  CHECKOUT_REMOVED,
  resumeCommand,
  resumeStepSession,
  type ResumeDeps
} from './resume-session'

const run = { id: 'r1', itemLabel: '!1 web-1', worktreePath: '/wt/a' } as RunRow
const step = (over: Partial<StepRow>): StepRow =>
  ({
    idx: 0,
    name: 'fix',
    agent: 'claude',
    sessionId: '00000000-0000-4000-8000-000000000021',
    terminalHandle: 'term_1',
    paneKey: 'tab:leaf',
    ...over
  }) as StepRow

type Opts = {
  state?: SessionTerminalState | Record<string, SessionTerminalState>
  r?: RunRow
  more?: StepRow[]
  tabs?: string[]
  stepOn?: string[]
  claims?: SessionClaims
  starting?: boolean
}

function deps(
  s: StepRow,
  opts: Opts = {}
): ResumeDeps & { open: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> } {
  const state = opts.state ?? 'gone'
  return {
    run: () => opts.r ?? run,
    steps: () => [s, ...(opts.more ?? [])],
    state: vi.fn(async (t) => (typeof state === 'string' ? state : (state[t.handle] ?? 'gone'))),
    tabs: vi.fn(async () =>
      (opts.tabs ?? []).map((handle) => ({ handle, paneKey: `${handle}:leaf` }))
    ),
    stepOn: (h) => (opts.stepOn ?? []).includes(h),
    claims: opts.claims,
    startingOn: () => opts.starting === true,
    isOpen: async () => true,
    focus: vi.fn(async () => {}),
    open: vi.fn(async () => ({ handle: 'term_new' }))
  }
}

describe('resumeCommand', () => {
  it.each([
    [
      'claude',
      '00000000-0000-4000-8000-000000000021',
      'claude --resume 00000000-0000-4000-8000-000000000021'
    ],
    [
      'codex',
      '00000000-0000-4000-8000-000000000029',
      'codex resume 00000000-0000-4000-8000-000000000029'
    ],
    ['shell', '00000000-0000-4000-8000-000000000021', null],
    ['claude', '00000000-0000-4000-8000-000000000021; rm -rf ~', null]
  ])('%s %s → %s', (agent, id, expected) => {
    expect(resumeCommand(agent, id)).toBe(expected)
  })
})

describe('resumeStepSession', () => {
  it.each(['free', 'busy'] as const)(
    "switches to the session's tab while it is live (%s), never a second process",
    async (state) => {
      const d = deps(step({}), { state })
      expect(await resumeStepSession(d, { runId: 'r1', stepIdx: 0 })).toEqual({
        action: 'focused',
        handle: 'term_1'
      })
      expect(d.focus).toHaveBeenCalledWith('term_1')
      expect(d.open).not.toHaveBeenCalled()
    }
  )

  it('finds the live tab of the same session on a later step of the run', async () => {
    const later = step({ idx: 1, name: 'again', terminalHandle: 'term_2', paneKey: 'tab2:leaf' })
    const d = deps(step({}), { state: { term_1: 'gone', term_2: 'free' }, more: [later] })
    expect(await resumeStepSession(d, { runId: 'r1', stepIdx: 0 })).toEqual({
      action: 'focused',
      handle: 'term_2'
    })
    expect(d.open).not.toHaveBeenCalled()
  })

  it.each(['gone', 'other'] as const)(
    'opens the session in a new tab in the worktree when no tab holds it (%s)',
    async (state) => {
      const d = deps(step({ agent: 'codex', sessionId: '00000000-0000-4000-8000-000000000022' }), {
        state
      })
      expect(await resumeStepSession(d, { runId: 'r1', stepIdx: 0 })).toEqual({
        action: 'opened',
        handle: 'term_new'
      })
      expect(d.open).toHaveBeenCalledWith(
        'path:/wt/a',
        'codex resume 00000000-0000-4000-8000-000000000022',
        'Resume · !1 web-1 · fix'
      )
      expect(d.focus).not.toHaveBeenCalled()
    }
  )

  it("focuses a tab no step row of this run names: another run's per_worktree session, one opened by hand or by an earlier Resume", async () => {
    const d = deps(step({}), {
      state: { term_1: 'gone', other_run_tab: 'busy' },
      tabs: ['other_run_tab']
    })
    expect(await resumeStepSession(d, { runId: 'r1', stepIdx: 0 })).toEqual({
      action: 'focused',
      handle: 'other_run_tab'
    })
    expect(d.open).not.toHaveBeenCalled()
  })

  it('a second Resume focuses the tab the first one opened instead of opening another', async () => {
    const d = deps(step({}), { state: { new_tab: 'free' }, tabs: ['new_tab'] })
    expect((await resumeStepSession(d, { runId: 'r1', stepIdx: 0 })).action).toBe('focused')
  })

  it('opens a new tab for a step that never recorded a tab', async () => {
    const d = deps(step({ terminalHandle: null, paneKey: null }))
    expect((await resumeStepSession(d, { runId: 'r1', stepIdx: 0 })).action).toBe('opened')
  })

  it.each([
    ['an unknown step', step({ idx: 4 }), {}, 'No step 0 in run r1'],
    ['a shell step', step({ agent: 'shell' }), {}, 'This step has no agent session to resume'],
    [
      'a step that never got a session',
      step({ sessionId: null }),
      {},
      'This step has no agent session to resume'
    ],
    [
      'a run with no worktree',
      step({ terminalHandle: null }),
      { r: { ...run, worktreePath: null } },
      'Run r1 has no worktree to resume in'
    ]
  ])('refuses %s', async (_name, s, opts, message) => {
    await expect(
      resumeStepSession(deps(s, opts as Opts), { runId: 'r1', stepIdx: 0 })
    ).rejects.toThrow(message)
  })
})

// M4 §8: a throwaway is disposable. Ruling P11: refused only once its run ended (its folder went with it).
describe("Resume of an env run's step", () => {
  const env = (mode: EnvMode, removedAt: number | null): RunEnv => ({
    state: removedAt === null ? 'ready' : 'removed',
    mode,
    reason: '',
    path: '/agents/agents-r1',
    sha: null,
    envFile: null,
    vars: {},
    stack: null,
    removedAt,
    deleteError: null,
    deleteAttempts: 0
  })
  it.each([
    [
      'an ended throwaway with no live tab: its checkout is gone',
      'throwaway',
      'done',
      9,
      'gone',
      CHECKOUT_REMOVED
    ],
    [
      'an ended throwaway whose tab is still live: focused, as before',
      'throwaway',
      'done',
      9,
      'free',
      'focused'
    ],
    [
      'a running throwaway with no live tab: reopened in its folder',
      'throwaway',
      'running',
      null,
      'gone',
      'opened'
    ],
    ['in place with no live tab: reopened in its worktree', 'in_place', 'done', 9, 'gone', 'opened']
  ] as const)('%s', async (_name, mode, status, removedAt, state, expected) => {
    const r = { ...run, status, env: env(mode, removedAt) } as RunRow
    const d = deps(step({}), { r, state })
    const call = resumeStepSession(d, { runId: 'r1', stepIdx: 0 })
    if (expected === CHECKOUT_REMOVED) {
      await expect(call).rejects.toThrow(CHECKOUT_REMOVED)
      expect(d.open).not.toHaveBeenCalled()
    } else {
      expect((await call).action).toBe(expected)
    }
  })
})

describe('resumeStepSession, the race window before the new agent posts a row', () => {
  const req = { runId: 'r1', stepIdx: 0 }

  it('two Resumes at once open one tab; the second is told it is opening', async () => {
    const claims = new SessionClaims()
    const d = deps(step({}), { claims })
    const results = await Promise.allSettled([resumeStepSession(d, req), resumeStepSession(d, req)])
    expect(d.open).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.status).toSorted()).toEqual(['fulfilled', 'rejected'])
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: expect.objectContaining({ message: 'Session is opening… try again in a moment' })
    })
  })

  it('a second Resume focuses the tab the first opened, once its handle is known', async () => {
    const claims = new SessionClaims()
    const d = deps(step({}), { claims })
    await resumeStepSession(d, req)
    expect(await resumeStepSession(d, req)).toEqual({ action: 'focused', handle: 'term_new' })
    expect(d.open).toHaveBeenCalledTimes(1)
  })

  it("refuses while a launcher's step is starting on the session, opening nothing", async () => {
    const d = deps(step({ terminalHandle: null }), { claims: new SessionClaims(), starting: true })
    await expect(resumeStepSession(d, req)).rejects.toThrow(
      'Session is opening… try again in a moment'
    )
    expect(d.open).not.toHaveBeenCalled()
  })

  it("refuses while a launcher's claim holds the session", async () => {
    const claims = new SessionClaims()
    claims.acquire('00000000-0000-4000-8000-000000000021', 'launch:r2:0')
    const d = deps(step({}), { claims })
    await expect(resumeStepSession(d, req)).rejects.toThrow('Session is opening…')
    expect(d.open).not.toHaveBeenCalled()
  })

  it('releases the claim when opening fails, and after the TTL', async () => {
    const claims = new SessionClaims()
    const d = deps(step({}), { claims })
    d.open.mockRejectedValueOnce(new Error('no pty'))
    await expect(resumeStepSession(d, req)).rejects.toThrow('no pty')
    expect(claims.holder('00000000-0000-4000-8000-000000000021')).toBeNull()
  })

  it.each([
    ['createTerminal gave no reply', 'Terminal creation timed out'],
    ['the handle never appeared', 'Timed out waiting for terminal handle after creation']
  ])(
    'keeps the claim when opening times out (%s): the tab may still appear',
    async (_n, message) => {
      const claims = new SessionClaims()
      const d = deps(step({}), { claims })
      d.open.mockRejectedValueOnce(new Error(message))
      await expect(resumeStepSession(d, req)).rejects.toThrow(message)
      expect(claims.holder('00000000-0000-4000-8000-000000000021')).toMatchObject({ handle: null })
      await expect(resumeStepSession(d, req)).rejects.toThrow('Session is opening…')
      expect(d.open).toHaveBeenCalledTimes(1)
    }
  )

  it('a remnant row on the old tab never drops the in-flight claim: two Resumes open one tab', async () => {
    const clock = { t: 100_000 }
    // The old tab T1 is gone by the launcher's judgement, but its surviving shell keeps a session-only row.
    const judgeDeps = {
      panes: async () => [{ handle: 'T1', paneKey: 'T1:leaf', rowAt: null }],
      state: async () => 'gone' as const,
      isOpen: async () => true
    }
    const claims = new SessionClaims(
      () => clock.t,
      (id, claim) => judgeClaim(judgeDeps, id, claim, clock.t)
    )
    const d = deps(step({ terminalHandle: 'T1' }), { claims, tabs: ['T1'] })
    d.open.mockResolvedValueOnce({ handle: 'T_new_1' }).mockResolvedValueOnce({ handle: 'T_new_2' })
    const first = await resumeStepSession(d, req)
    clock.t += 1_000
    const second = await resumeStepSession(d, req)
    expect(first).toEqual({ action: 'opened', handle: 'T_new_1' })
    expect(second).toEqual({ action: 'focused', handle: 'T_new_1' })
    expect(d.open).toHaveBeenCalledTimes(1)
  })

  it("a tabs() snapshot older than the first opener's row can't release its claim", async () => {
    const clock = { t: 100_000 }
    const judgeDeps = {
      panes: async () => [{ handle: 'T_old', paneKey: 'T_old:leaf', rowAt: 50_000 }],
      state: async () => 'free' as const,
      isOpen: async () => true
    }
    const claims = new SessionClaims(
      () => clock.t,
      (id, claim) => judgeClaim(judgeDeps, id, claim, clock.t)
    )
    claims.acquire('00000000-0000-4000-8000-000000000021', 'resume:first')
    const d = deps(step({ terminalHandle: null }), { claims })
    await expect(resumeStepSession(d, req)).rejects.toThrow('Session is opening…')
    expect(d.open).not.toHaveBeenCalled()
    expect(claims.holder('00000000-0000-4000-8000-000000000021')).toMatchObject({
      by: 'resume:first'
    })
  })

  it('acquires before it looks, and releases when the look finds a live tab (nothing opened)', async () => {
    const claims = new SessionClaims()
    const d = deps(step({}), { claims, state: { term_1: 'free' } })
    expect((await resumeStepSession(d, req)).action).toBe('focused')
    expect(claims.holder('00000000-0000-4000-8000-000000000021')).toBeNull()
  })

  it('does not focus the tab of a claim whose start is closed; says the start did not come up', async () => {
    const claims = new SessionClaims()
    claims.acquire('00000000-0000-4000-8000-000000000021', 'launch:r2:0')
    claims.setHandle('00000000-0000-4000-8000-000000000021', 'launch:r2:0', 'T_dead')
    const d = {
      ...deps(step({ terminalHandle: null }), { claims }),
      isOpen: vi.fn(async () => false)
    }
    await expect(resumeStepSession(d, req)).rejects.toThrow(
      "A previous start of this session didn't come up; try again"
    )
    expect(d.focus).not.toHaveBeenCalled()
  })
})
