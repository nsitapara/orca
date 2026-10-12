import { describe, expect, it } from 'vitest'
import { sessionPatch } from './session-pin'

const step = (sessionId: string | null, transcriptPath: string | null = null) => ({
  sessionId,
  transcriptPath
})

describe('sessionPatch', () => {
  it.each([
    ['nothing seen yet', step(null), null, null],
    [
      'a Codex step takes the first id its hooks report',
      step(null),
      { id: 'c1', transcriptPath: '/r/c1.jsonl' },
      { sessionId: 'c1', transcriptPath: '/r/c1.jsonl' }
    ],
    [
      'the first id without a path yet',
      step(null),
      { id: 'c1', transcriptPath: null },
      { sessionId: 'c1' }
    ],
    [
      'a later session in the same tab never re-points the step',
      step('c1', '/r/c1.jsonl'),
      { id: 'c2', transcriptPath: '/r/c2.jsonl' },
      null
    ],
    [
      'a pinned Claude id gets its transcript path from its own hook row',
      step('s1'),
      { id: 's1', transcriptPath: '/t/s1.jsonl' },
      { transcriptPath: '/t/s1.jsonl' }
    ],
    ['nothing new', step('s1', '/t/s1.jsonl'), { id: 's1', transcriptPath: '/t/s1.jsonl' }, null]
  ])('%s', (_name, s, seen, expected) => {
    expect(sessionPatch(s, seen)).toEqual(expected)
  })
})
