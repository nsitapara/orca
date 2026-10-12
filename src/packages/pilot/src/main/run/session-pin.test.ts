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
      {
        id: '00000000-0000-4000-8000-000000000031',
        transcriptPath: '/r/00000000-0000-4000-8000-000000000031.jsonl'
      },
      {
        sessionId: '00000000-0000-4000-8000-000000000031',
        transcriptPath: '/r/00000000-0000-4000-8000-000000000031.jsonl'
      }
    ],
    [
      'the first id without a path yet',
      step(null),
      { id: '00000000-0000-4000-8000-000000000031', transcriptPath: null },
      { sessionId: '00000000-0000-4000-8000-000000000031' }
    ],
    [
      'a later session in the same tab never re-points the step',
      step('00000000-0000-4000-8000-000000000031', '/r/00000000-0000-4000-8000-000000000031.jsonl'),
      {
        id: '00000000-0000-4000-8000-000000000032',
        transcriptPath: '/r/00000000-0000-4000-8000-000000000032.jsonl'
      },
      null
    ],
    [
      'a pinned Claude id gets its transcript path from its own hook row',
      step('00000000-0000-4000-8000-000000000033'),
      {
        id: '00000000-0000-4000-8000-000000000033',
        transcriptPath: '/t/00000000-0000-4000-8000-000000000033.jsonl'
      },
      { transcriptPath: '/t/00000000-0000-4000-8000-000000000033.jsonl' }
    ],
    [
      'nothing new',
      step('00000000-0000-4000-8000-000000000033', '/t/00000000-0000-4000-8000-000000000033.jsonl'),
      {
        id: '00000000-0000-4000-8000-000000000033',
        transcriptPath: '/t/00000000-0000-4000-8000-000000000033.jsonl'
      },
      null
    ]
  ])('%s', (_name, s, seen, expected) => {
    expect(sessionPatch(s, seen)).toEqual(expected)
  })
})
