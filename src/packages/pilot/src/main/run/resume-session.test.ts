import { describe, expect, it, vi } from 'vitest'
import type { RunRow, StepRow } from '../../shared/api-types'
import type { SessionTerminalState } from './agent-step'
import { resumeCommand, resumeStepSession, type ResumeDeps } from './resume-session'

const run = { id: 'r1', itemLabel: '!1 web-1', worktreePath: '/wt/a' } as RunRow
const step = (over: Partial<StepRow>): StepRow =>
  ({
    idx: 0,
    name: 'fix',
    agent: 'claude',
    sessionId: 's1',
    terminalHandle: 'term_1',
    paneKey: 'tab:leaf',
    ...over
  }) as StepRow

type Opts = {
  state?: SessionTerminalState | Record<string, SessionTerminalState>
  r?: RunRow
  more?: StepRow[]
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
    focus: vi.fn(async () => {}),
    open: vi.fn(async () => ({ handle: 'term_new' }))
  }
}

describe('resumeCommand', () => {
  it.each([
    ['claude', 's1', 'claude --resume s1'],
    ['codex', 'c-9', 'codex resume c-9'],
    ['shell', 's1', null],
    ['claude', 's1; rm -rf ~', null]
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
      const d = deps(step({ agent: 'codex', sessionId: 'c1' }), { state })
      expect(await resumeStepSession(d, { runId: 'r1', stepIdx: 0 })).toEqual({
        action: 'opened',
        handle: 'term_new'
      })
      expect(d.open).toHaveBeenCalledWith(
        'path:/wt/a',
        'codex resume c1',
        'Resume · !1 web-1 · fix'
      )
      expect(d.focus).not.toHaveBeenCalled()
    }
  )

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
