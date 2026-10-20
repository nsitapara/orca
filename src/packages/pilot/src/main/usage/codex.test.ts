import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codexUsage, findCodexRollout } from './codex'

const at = (h: number, m = 0): number => new Date(2026, 9, 11, h, m).getTime()
const iso = (h: number, m = 0): string => new Date(at(h, m)).toISOString()
const usage = (input: number, cached: number, output: number) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  output_tokens: output,
  total_tokens: input + output
})

function rollout(dir: string): string {
  const path = join(dir, 'rollout-2026-10-11T10-00-00-sess-c.jsonl')
  const lines = [
    { timestamp: iso(10), type: 'session_meta', payload: { id: 'sess-c', cwd: '/wt' } },
    { timestamp: iso(10), type: 'turn_context', payload: { model: 'gpt-5.5', cwd: '/wt' } },
    {
      timestamp: iso(10, 5),
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { last_token_usage: usage(1000, 400, 100), total_token_usage: usage(1000, 400, 100) }
      }
    },
    {
      timestamp: iso(12),
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { last_token_usage: usage(500, 0, 50), total_token_usage: usage(1500, 400, 150) }
      }
    }
  ]
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`)
  return path
}

function recordRollout(dir: string): string {
  const path = join(dir, 'rollout-2026-10-11T10-00-00-sess-r.jsonl')
  const own = {
    input_tokens: 1000,
    cached_input_tokens: 400,
    cache_write_input_tokens: 100,
    output_tokens: 100
  }
  const record = (m: number, thread: string, response: string, u: Record<string, number>) => ({
    timestamp: iso(10, m),
    type: 'token_usage_record',
    payload: { thread_id: thread, turn_id: 't1', response_id: response, usage: u }
  })
  const lines = [
    { timestamp: iso(10), type: 'session_meta', payload: { id: 'sess-r', cwd: '/wt' } },
    {
      timestamp: iso(10),
      type: 'turn_context',
      payload: { turn_id: 't1', model: 'gpt-5.5', cwd: '/wt' }
    },
    record(1, 'sess-r', 'r1', own),
    record(1, 'sess-r', 'r1', own),
    record(2, 'other', 'r2', {
      input_tokens: 5,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      output_tokens: 5
    }),
    {
      timestamp: iso(10, 1),
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { last_token_usage: usage(1000, 400, 100), total_token_usage: usage(1000, 400, 100) }
      }
    }
  ]
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`)
  return path
}

describe('codexUsage', () => {
  it("counts the rollout's own token_usage_records once per response, as usage.py does, and not its token_count events", async () => {
    const path = recordRollout(mkdtempSync(join(tmpdir(), 'pilot-codex-')))
    // gpt-5.5: 600 uncached input × $5 + 400 cached × $0.50 + 100 output × $30, per million; 100 of the cached were written.
    expect(await codexUsage(path, { from: at(10), to: at(11) })).toEqual([
      {
        agent: 'codex',
        day: '2026-10-11',
        model: 'gpt-5.5',
        requests: 1,
        input: 600,
        cacheRead: 300,
        cacheWrite: 100,
        output: 100,
        costUsd: expect.closeTo(0.0062, 10)
      }
    ])
  })

  it("counts a rollout's token_count turns inside the step's window when it has no token_usage_record", async () => {
    const path = rollout(mkdtempSync(join(tmpdir(), 'pilot-codex-')))
    // gpt-5.5: 600 uncached input × $5 + 400 cached × $0.50 + 100 output × $30, per million.
    expect(await codexUsage(path, { from: at(10), to: at(11) })).toEqual([
      {
        agent: 'codex',
        day: '2026-10-11',
        model: 'gpt-5.5',
        requests: 1,
        input: 600,
        cacheRead: 400,
        cacheWrite: 0,
        output: 100,
        costUsd: expect.closeTo(0.0062, 10)
      }
    ])
  })

  it('reads nothing from a rollout that is gone', async () => {
    expect(await codexUsage('/no/such/rollout.jsonl', { from: 0, to: at(23) })).toEqual([])
  })
})

describe('findCodexRollout', () => {
  it('takes the hook path, else finds rollout-*-<id>.jsonl in the day folders around the start', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pilot-codex-home-'))
    const day = join(home, 'sessions', '2026', '10', '11')
    mkdirSync(day, { recursive: true })
    const path = rollout(day)
    expect(await findCodexRollout('sess-c', path, at(10), [home])).toBe(path)
    expect(await findCodexRollout('sess-c', null, at(10), ['/no/home', home])).toBe(path)
    expect(await findCodexRollout('sess-x', null, at(10), [home])).toBeNull()
  })

  it('finds a session that started days before the step that resumed it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pilot-codex-home-'))
    const day = join(home, 'sessions', '2026', '10', '06')
    mkdirSync(day, { recursive: true })
    const path = rollout(day)
    expect(await findCodexRollout('sess-c', null, at(10), [home])).toBe(path)
  })
})
