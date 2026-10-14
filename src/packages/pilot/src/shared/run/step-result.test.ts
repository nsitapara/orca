import { describe, expect, it } from 'vitest'
import { readStepResult, TEXT_OMITTED, type ResultRead } from './step-result'

const HEAD = { command: 'skills get-context', outcome: 'ok', reason: '2 failed jobs' }
const out = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ v: 1, ...HEAD, data: { pipeline_id: 2934 }, meta: { took_ms: 3 }, ...over })
const NONE: ResultRead = { stored: null, reason: null, text: false }
const kept = (data: unknown): ResultRead => ({
  stored: { ...HEAD, data, meta: { took_ms: 3 } },
  reason: HEAD.reason,
  text: false
})
const omitted = (why: string): ResultRead => ({
  stored: { ...HEAD, meta: { took_ms: 3 }, data_omitted: why },
  reason: HEAD.reason,
  text: false
})

describe('readStepResult', () => {
  it.each<[string, string, ResultRead]>([
    ['one envelope', out(), kept({ pipeline_id: 2934 })],
    ['one envelope between blank lines', `\n${out()}\n\n`, kept({ pipeline_id: 2934 })],
    [
      'a pretty-printed envelope',
      JSON.stringify(JSON.parse(out()), null, 2),
      kept({ pipeline_id: 2934 })
    ],
    [
      'no reason, data or meta',
      JSON.stringify({ v: 1, command: 'git push-branch', outcome: 'ok' }),
      {
        stored: { command: 'git push-branch', outcome: 'ok', reason: '', data: null, meta: {} },
        reason: '',
        text: false
      }
    ],
    [
      'marked meta.text: outcome and reason only',
      out({ meta: { text: true } }),
      { stored: { ...HEAD, data_omitted: TEXT_OMITTED }, reason: HEAD.reason, text: true }
    ],
    [
      'data of exactly 256 KB',
      out({ data: 'x'.repeat(256 * 1024 - 2) }),
      kept('x'.repeat(256 * 1024 - 2))
    ],
    [
      'data one byte over 256 KB',
      out({ data: 'x'.repeat(256 * 1024 - 1) }),
      omitted('too large (257 KB)')
    ],
    [
      'multi-byte data, counted in bytes',
      out({ data: 'é'.repeat(140 * 1024) }),
      omitted('too large (281 KB)')
    ],
    ['v 2', out({ v: 2 }), NONE],
    ['no command', JSON.stringify({ v: 1, outcome: 'ok' }), NONE],
    ['an envelope, then a log line', `${out()}\ndone\n`, NONE],
    ['a JSON list', '[1, 2]', NONE],
    ['plain text', 'pruned 3 images\n', NONE],
    ['nothing', '', NONE]
  ])('%s', (_name, stdout, expected) => {
    expect(readStepResult(stdout)).toEqual(expected)
  })
})
