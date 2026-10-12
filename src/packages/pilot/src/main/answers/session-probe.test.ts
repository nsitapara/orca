import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SessionTerminalState } from '../run/agent-step'
import {
  DraftInProgressError,
  findTranscript,
  sessionPromptSender,
  sessionTerminalProbe
} from './session-probe'

describe('findTranscript', () => {
  function home() {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-home-'))
    mkdirSync(join(dir, '.claude', 'projects', '-Users-n-wt'), { recursive: true })
    writeFileSync(join(dir, '.claude', 'projects', '-Users-n-wt', 'sess-1.jsonl'), 'x'.repeat(10))
    const day = join(dir, '.codex', 'sessions', '2026', '10', '11')
    mkdirSync(day, { recursive: true })
    writeFileSync(join(day, 'rollout-2026-10-11T09-00-00-cx-9.jsonl'), 'y'.repeat(20))
    utimesSync(join(day, 'rollout-2026-10-11T09-00-00-cx-9.jsonl'), 1000, 1000)
    return dir
  }

  it.each([
    ['a Claude session under any project', 'claude', 'sess-1', 10],
    ['a Codex rollout anywhere under sessions/', 'codex', 'cx-9', 20]
  ] as const)('finds %s', (_name, agent, id, size) => {
    expect(findTranscript(agent, id, null, home(), undefined)?.size).toBe(size)
  })

  it('prefers the path the step recorded, and finds nothing for an unknown session', () => {
    const dir = home()
    const known = join(dir, 'known.jsonl')
    writeFileSync(known, 'z')
    expect(findTranscript('claude', 'other', known, dir, undefined)?.size).toBe(1)
    expect(findTranscript('claude', 'nope', null, dir, undefined)).toBeNull()
  })
})

describe('sessionTerminalProbe (the run launcher’s H10 look, plus who is on the tab)', () => {
  function deps(
    state: SessionTerminalState | Record<string, SessionTerminalState>,
    draft: string | Error = '',
    pilotStep = false,
    tabs: string[] = []
  ) {
    return {
      terminals: {
        state: vi.fn(async (t: { handle: string }) =>
          typeof state === 'string' ? state : (state[t.handle] ?? 'gone')
        ),
        tabs: vi.fn(async () => tabs.map((handle) => ({ handle, paneKey: `${handle}:leaf` }))),
        send: vi.fn(),
        close: vi.fn()
      },
      draft: vi.fn(async () => {
        if (draft instanceof Error) {
          throw draft
        }
        return draft
      }),
      stepOn: vi.fn(() => pilotStep)
    }
  }
  const ASKING = { handle: 't', paneKey: 'tab:leaf', sessionId: 's-1' }

  it.each<[string, ReturnType<typeof deps>, string]>([
    ['its session, idle, no draft', deps('free'), 'free'],
    ['another session in the tab', deps('other'), 'other'],
    ['a closed tab', deps('gone'), 'gone'],
    ['a draft in its input', deps('busy', 'hi'), 'typing'],
    ['an agent working', deps('busy'), 'busy'],
    ["a draft that can't be read", deps('busy', new Error('read failed')), 'busy']
  ])('%s → %s', async (_name, d, expected) => {
    expect(await sessionTerminalProbe(d).terminalState(ASKING)).toBe(expected)
    expect(d.terminals.state).toHaveBeenCalledWith({ handle: 't', paneKey: 'tab:leaf' }, 's-1')
  })

  it.each<[string, ReturnType<typeof deps>, string]>([
    ['busy: it is working', deps({ t: 'gone', user: 'busy' }, '', false, ['user']), 'busy'],
    [
      'typing: someone has a draft in it',
      deps({ t: 'gone', user: 'busy' }, 'hi', false, ['user']),
      'typing'
    ],
    [
      "busy, never free: its process args aren't Pilot's to trust",
      deps({ t: 'other', user: 'free' }, '', false, ['user']),
      'busy'
    ],
    ['gone when no tab holds the session', deps({ t: 'gone' }, '', false, []), 'gone']
  ])('a tab the asking step never recorded, opened by hand: %s', async (_name, d, expected) => {
    expect(await sessionTerminalProbe(d).terminalState(ASKING)).toBe(expected)
  })

  it('reads a tab a Pilot step is starting or running on as busy, without looking', async () => {
    const d = deps('free', '', true)
    expect(await sessionTerminalProbe(d).terminalState(ASKING)).toBe('busy')
    expect(d.terminals.state).not.toHaveBeenCalled()
  })
})

describe('sessionPromptSender', () => {
  it("types the prompt through the launcher's send (an idle agent, then a turn)", async () => {
    const send = vi.fn(async () => {})
    const sender = sessionPromptSender({
      terminals: { state: vi.fn(), send, close: vi.fn() },
      draft: async () => ''
    })
    await sender('t', 'Answers…')
    expect(send).toHaveBeenCalledWith('t', 'Answers…')
  })

  it('refuses, typing nothing, while someone is typing there', async () => {
    const send = vi.fn(async () => {})
    const sender = sessionPromptSender({
      terminals: { state: vi.fn(), send, close: vi.fn() },
      draft: async () => 'hi'
    })
    await expect(sender('t', 'x')).rejects.toBeInstanceOf(DraftInProgressError)
    expect(send).not.toHaveBeenCalled()
  })

  it("fails when the agent doesn't take it", async () => {
    const sender = sessionPromptSender({
      terminals: {
        state: vi.fn(),
        send: vi.fn().mockRejectedValue(new Error("the agent didn't start a turn on the prompt")),
        close: vi.fn()
      },
      draft: async () => ''
    })
    await expect(sender('t', 'x')).rejects.toThrow("didn't start a turn")
  })
})
