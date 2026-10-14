import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { InboxItemRow } from '../../shared/api-types'
import { PilotStore } from '../store/store'
import { chooseSession, FORK_MAX_AGE_MS, type SessionProbe, type TerminalState } from './sessions'

const BASE =
  'name: Fix CI\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, skill: fix-gitlab-ci, prompt: x } ]\ninbox: nish\n'
function definition(extra = '') {
  const parsed = parseAutomationYaml(BASE + extra, '/a/ci.yaml')
  if (!parsed.ok) {
    throw new Error(parsed.errors.join('\n'))
  }
  return parsed.definition
}
const NOW = 10 * 24 * 60 * 60_000

function setup(
  session: string | null = '00000000-0000-4000-8000-000000000001',
  launchArgs: string[] | null = []
) {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-sessions-')), 'db.sqlite'))
  store.runs.create({
    id: 'run-1',
    automationId: 'ci',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1',
    worktreePath: '/wt',
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
    launchArgs,
    ...(session ? { sessionId: session } : {})
  })
  const items = [{ id: 'in_a', runId: 'run-1', stepIdx: 0, createdAt: 5 }] as InboxItemRow[]
  return { store, items }
}

function probe(
  state: TerminalState,
  transcript: { size: number; mtimeMs: number } | null
): SessionProbe {
  return { terminalState: vi.fn(async () => state), transcript: async () => transcript }
}
const FRESH = { size: 1_000, mtimeMs: NOW - 60_000 }

describe('chooseSession (apply.py start_agent)', () => {
  it.each<[string, TerminalState, { size: number; mtimeMs: number } | null, string]>([
    [
      'the asking tab is free (its session, idle, no draft, no Pilot step)',
      'free',
      FRESH,
      'resume'
    ],
    ['the asking tab is busy', 'busy', FRESH, 'fork'],
    ['the asking tab runs another session now', 'other', FRESH, 'fork'],
    ['the asking tab is gone', 'gone', FRESH, 'fork'],
    [
      'the transcript is over 3 days old',
      'gone',
      { size: 1_000, mtimeMs: NOW - FORK_MAX_AGE_MS - 1 },
      'new'
    ],
    ['the transcript is over 8 MB', 'gone', { size: 8_000_001, mtimeMs: NOW }, 'new'],
    ['there is no transcript', 'gone', null, 'new']
  ])('%s → %s', async (_name, state, transcript, kind) => {
    const { store, items } = setup()
    expect(
      (await chooseSession(definition(), items, store, probe(state, transcript), NOW)).kind
    ).toBe(kind)
  })

  // An agent-reported id shaped like a flag never reaches a resume or fork argv: a new session instead.
  it.each(['free', 'gone'] as const)(
    'starts a new session when the asking id is not a session id (tab %s)',
    async (state) => {
      const { store, items } = setup('--dangerously-skip-permissions')
      const target = await chooseSession(definition(), items, store, probe(state, FRESH), NOW)
      expect(target).toMatchObject({ kind: 'new' })
    }
  )

  it('looks at the tab that asked, for the session that asked', async () => {
    const { store, items } = setup()
    const look = probe('free', FRESH)
    await chooseSession(definition(), items, store, look, NOW)
    expect(look.terminalState).toHaveBeenCalledWith({
      handle: 'term-1',
      paneKey: 'tab:leaf',
      sessionId: '00000000-0000-4000-8000-000000000001'
    })
  })

  it('holds while someone is typing in the asking tab', async () => {
    const { store, items } = setup()
    expect(await chooseSession(definition(), items, store, probe('typing', FRESH), NOW)).toEqual({
      kind: 'hold',
      hold: { holdReason: 'typing', holdDetail: 'someone is typing in the tab that asked' }
    })
  })

  it("forks instead of typing into a free tab whose process args aren't known", async () => {
    const { store, items } = setup('00000000-0000-4000-8000-000000000001', null)
    expect((await chooseSession(definition(), items, store, probe('free', FRESH), NOW)).kind).toBe(
      'fork'
    )
  })

  it("starts a new session in the step's skill and answers mode when nothing can be resumed", async () => {
    const { store, items } = setup(null)
    const look = probe('free', FRESH)
    expect(await chooseSession(definition(), items, store, look, NOW)).toEqual({
      kind: 'new',
      agent: 'claude',
      skill: 'fix-gitlab-ci',
      mode: 'answers'
    })
    // No session id: nothing to check the tab against, so it is never typed into.
    expect(look.terminalState).not.toHaveBeenCalled()
  })

  it('never resumes with resume: never, and uses answers.else', async () => {
    const { store, items } = setup()
    const def = definition(
      'answers: { resume: never, else: { agent: codex, skill: ci-answers, mode: answers } }\n'
    )
    expect(await chooseSession(def, items, store, probe('free', FRESH), NOW)).toEqual({
      kind: 'new',
      agent: 'codex',
      skill: 'ci-answers',
      mode: 'answers'
    })
  })
})

describe('a card from a throwaway run, decided at answer time', () => {
  it.each([
    [
      'throwaway: a fresh session carrying the card',
      'throwaway',
      { kind: 'new', fresh: 'throwaway' }
    ],
    ['in place: its own free tab, as before', 'in_place', { kind: 'resume' }],
    ['kept: its own free tab, as before', 'kept', { kind: 'resume' }]
  ] as const)('%s', async (_name, mode, expected) => {
    const { store, items } = setup()
    store.runs.envs.begin('run-1', '/wt', {})
    const folder = mode === 'throwaway' ? '/agents/agents-run-1' : '/wt'
    store.runs.envs.ready('run-1', {
      mode,
      reason: '',
      path: folder,
      home: '/wt',
      worktreeId: 'id',
      sha: null,
      envFile: null,
      vars: {},
      stack: null
    })
    expect(
      await chooseSession(definition(), items, store, probe('free', FRESH), NOW)
    ).toMatchObject(expected)
  })
})
