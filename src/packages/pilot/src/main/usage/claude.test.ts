import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { claudeSubagentFiles, claudeUsage, findClaudeTranscript } from './claude'

const at = (h: number, m = 0): number => new Date(2026, 9, 11, h, m).getTime()
const turn = (h: number, model: string | null = 'claude-opus-5-5') => ({
  timestamp: new Date(at(h)).toISOString(),
  model,
  inputTokens: 100,
  outputTokens: 10,
  cacheReadTokens: 1000,
  cacheWriteTokens: 50,
  cacheWrite1hTokens: 20
})
const WINDOW = { from: at(9, 30), to: at(11) }

describe('claudeUsage', () => {
  it('counts only turns inside the step window, across the session and its subagents', async () => {
    const files: Record<string, ReturnType<typeof turn>[]> = {
      '/main.jsonl': [turn(9), turn(10), turn(12)],
      '/sub.jsonl': [turn(10, 'claude-haiku-4-5')]
    }
    const estimate = (model: string | null): number => (model === 'claude-opus-5-5' ? 1 : 0.25)
    const buckets = await claudeUsage(
      Object.keys(files),
      WINDOW,
      async (p) => files[p] as never,
      estimate as never
    )
    expect(buckets).toEqual([
      {
        agent: 'claude',
        day: '2026-10-11',
        model: 'claude-haiku-4-5',
        requests: 1,
        input: 100,
        cacheRead: 1000,
        cacheWrite: 50,
        output: 10,
        costUsd: 0.25
      },
      {
        agent: 'claude',
        day: '2026-10-11',
        model: 'claude-opus-5-5',
        requests: 1,
        input: 100,
        cacheRead: 1000,
        cacheWrite: 50,
        output: 10,
        costUsd: 1
      }
    ])
  })

  it('prices every cache write, passing the 1-hour share separately', async () => {
    const estimate = vi.fn(() => 0.1)
    await claudeUsage(['/a.jsonl'], WINDOW, async () => [turn(10)] as never, estimate as never)
    expect(estimate).toHaveBeenCalledWith(
      'claude-opus-5-5',
      expect.objectContaining({
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 1000,
        cacheWriteTokens: 50,
        cacheWrite1hTokens: 20
      })
    )
  })

  it('skips a file it cannot read, and synthetic or model-less turns', async () => {
    const parse = async (p: string) => {
      if (p === '/gone.jsonl') {
        throw new Error('ENOENT')
      }
      return [turn(10, '<synthetic>'), turn(10, null)] as never
    }
    expect(
      await claudeUsage(['/gone.jsonl', '/b.jsonl'], WINDOW, parse, (() => 1) as never)
    ).toEqual([])
  })
})

describe('finding a Claude session on disk', () => {
  function projects(): { dir: string; file: string } {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-claude-'))
    mkdirSync(join(dir, '-Users-me-wt'))
    const file = join(dir, '-Users-me-wt', 'sess-1.jsonl')
    writeFileSync(file, '')
    return { dir, file }
  }

  it('takes the hook path when it exists, else searches every project folder', async () => {
    const { dir, file } = projects()
    expect(await findClaudeTranscript('sess-1', file, dir)).toBe(file)
    expect(await findClaudeTranscript('sess-1', '/gone/sess-1.jsonl', dir)).toBe(file)
    expect(await findClaudeTranscript('sess-2', null, dir)).toBeNull()
    expect(await findClaudeTranscript('sess-1', null, '/no/such/projects')).toBeNull()
  })

  it('lists the subagent transcripts under <stem>/subagents, at any depth', async () => {
    const { dir, file } = projects()
    const nested = join(dir, '-Users-me-wt', 'sess-1', 'subagents', 'a')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'x.jsonl'), '')
    writeFileSync(join(nested, 'notes.txt'), '')
    expect(await claudeSubagentFiles(file)).toEqual([join(nested, 'x.jsonl')])
    expect(await claudeSubagentFiles(join(dir, 'none.jsonl'))).toEqual([])
  })
})
