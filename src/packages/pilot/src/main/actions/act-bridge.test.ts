import { describe, expect, it, vi } from 'vitest'
import { actBridge, bridgeEnv, parseRunOutput, RUN_TIMEOUT_MS } from './act-bridge'

const ok = (stdout: string, code = 0) => ({ code, stdout, stderr: '', timedOut: false })

describe('bridgeEnv', () => {
  it("marks Pilot's own act.py and never passes a run id it would route back", () => {
    const env = bridgeEnv({ PATH: '/bin', PILOT_RUN_ID: 'x' }, 'ci-1')
    expect(env).toEqual({ PATH: '/bin', PILOT_BRIDGE: '1', AGENT_RUN: 'ci-1' })
  })
})

describe('parseRunOutput', () => {
  const line = JSON.stringify({
    script: 'push',
    args: [],
    outcome: 'done',
    detail: 'pushed web-1 to 9c1e2f04',
    link: 'https://x',
    log: '/l',
    on_you: false
  })
  it.each([
    [
      'the JSON line',
      ok(line),
      {
        outcome: 'done',
        detail: 'pushed web-1 to 9c1e2f04',
        link: 'https://x',
        log: '/l',
        onYou: false
      }
    ],
    [
      'the last JSON line after noise',
      ok(`warning: x\n${line}\n`),
      {
        outcome: 'done',
        detail: 'pushed web-1 to 9c1e2f04',
        link: 'https://x',
        log: '/l',
        onYou: false
      }
    ],
    [
      'a not-yet that waits on you',
      ok(JSON.stringify({ outcome: 'not_yet', detail: '1 open thread', on_you: true }), 5),
      { outcome: 'not_yet', detail: '1 open thread', link: null, log: null, onYou: true }
    ],
    [
      'no JSON',
      { code: 2, stdout: '', stderr: 'Traceback: boom', timedOut: false },
      {
        outcome: 'failed',
        detail: 'act.py exited 2: Traceback: boom',
        link: null,
        log: null,
        onYou: false
      }
    ],
    [
      'an unknown outcome',
      ok(JSON.stringify({ outcome: 'maybe' })),
      {
        outcome: 'failed',
        detail: 'act.py exited 0: {"outcome":"maybe"}',
        link: null,
        log: null,
        onYou: false
      }
    ],
    [
      'a timeout',
      { code: null, stdout: '', stderr: '', timedOut: true },
      {
        outcome: 'failed',
        detail: 'act.py timed out after 10 min',
        link: null,
        log: null,
        onYou: false
      }
    ]
  ])('reads %s', (_name, result, expected) => expect(parseRunOutput(result)).toEqual(expected))
})

describe('actBridge', () => {
  function bridge(stdout: string, code = 0) {
    const run = vi.fn().mockResolvedValue(ok(stdout, code))
    return {
      run,
      act: actBridge({ actPy: '/act.py', python: 'python3', run, env: { PATH: '/bin' } })
    }
  }

  it('runs a script with its pinned args, dry run last', async () => {
    const { run, act } = bridge(JSON.stringify({ outcome: 'done', detail: 'would push' }))
    await act.run('push', ['/wt', 'web-1', 'aaa', 'bbb'], { dryRun: true, runId: 'ci-1' })
    expect(run).toHaveBeenCalledWith({
      program: 'python3',
      args: ['/act.py', 'push', 'run', '/wt', 'web-1', 'aaa', 'bbb', '--dry-run'],
      env: { PATH: '/bin', PILOT_BRIDGE: '1', AGENT_RUN: 'ci-1' },
      timeoutMs: RUN_TIMEOUT_MS
    })
  })

  it.each([
    [
      'new args',
      JSON.stringify({ args: ['1561', 'ffff'], changed: 'the head moved to ffff' }),
      0,
      { argv: ['1561', 'ffff'], changed: 'the head moved to ffff' }
    ],
    ['nothing to refresh', 'null', 0, null],
    ['a crash', '', 1, null]
  ])('refresh reads %s', async (_name, stdout, code, expected) => {
    const { act } = bridge(stdout, code)
    expect(await act.refresh('mark-ready', ['1561', 'aaaa'])).toEqual(expected)
  })

  it('describes with the script, falling back to the command', async () => {
    expect(await bridge('Push web-1 to origin, aaa → bbb\n').act.describe('push', ['x'])).toBe(
      'Push web-1 to origin, aaa → bbb'
    )
    expect(await bridge('', 1).act.describe('push', ['x'])).toBe('push x')
  })

  it("fails, never throws, when python can't start", async () => {
    const run = vi.fn().mockRejectedValue(new Error('spawn python3 ENOENT'))
    const act = actBridge({ actPy: '/act.py', python: 'python3', run, env: {} })
    expect(await act.run('push', ['x'], { dryRun: false, runId: null })).toMatchObject({
      outcome: 'failed',
      detail: "act.py couldn't start: spawn python3 ENOENT"
    })
    expect(await act.describe('push', ['x'])).toBe('push x')
    expect(await act.refresh('push', ['x'])).toBeNull()
  })
})
