import { describe, expect, it } from 'vitest'
import { claudeTranscriptCost, formatCost } from './cost'

describe('claudeTranscriptCost', () => {
  it('sums tokens and the cost of turns with known pricing', async () => {
    const turns = [
      {
        model: 'claude-opus-5-5',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        cacheWrite1hTokens: 0
      },
      {
        model: 'unknown-model',
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cacheWrite1hTokens: 0
      }
    ]
    const result = await claudeTranscriptCost(
      '/t.jsonl',
      async () => turns as never,
      (model) => (model === 'unknown-model' ? null : 0.5)
    )
    expect(result).toEqual({ costUsd: 0.5, tokens: 167 })
  })

  it('returns no cost and no tokens for an unreadable transcript, without throwing', async () => {
    const failing = async () => {
      throw new Error('ENOENT')
    }
    expect(await claudeTranscriptCost('/nope.jsonl', failing)).toEqual({ costUsd: null, tokens: 0 })
    expect(await claudeTranscriptCost('/definitely/missing.jsonl')).toEqual({
      costUsd: null,
      tokens: 0
    })
  })
})

describe('formatCost', () => {
  it.each([
    [null, '—'],
    [0, '$0.00'],
    [1.954, '$1.95']
  ])('%s → %s', (v, s) => expect(formatCost(v)).toBe(s))
})
