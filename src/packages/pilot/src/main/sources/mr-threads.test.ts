import { describe, expect, it } from 'vitest'
import { fakeGlab, sourceContext } from './__fixtures__/source-context'
import { readWaitingThreads, waitingThreads, type GitLabDiscussion } from './mr-threads'

const HEAD = Date.parse('2026-10-08T13:36:51-07:00')

function note(
  author: string,
  { resolvable = true, resolved = false, system = false, at = '2026-10-08T20:00:00Z' } = {}
) {
  return { author: { username: author }, resolvable, resolved, system, created_at: at }
}
const thread = (...notes: ReturnType<typeof note>[]): GitLabDiscussion => ({ notes })

describe('waitingThreads (mr-feedback-sweep waiting())', () => {
  it.each([
    ['reviewer asked, no reply', [thread(note('emil'))], 1],
    ['I replied last', [thread(note('emil'), note('me'))], 0],
    ['reviewer followed up', [thread(note('emil'), note('me'), note('emil'))], 1],
    ['resolved', [thread(note('emil', { resolved: true }))], 0],
    ['my own thread', [thread(note('me'), note('emil'))], 0],
    ['system note last', [thread(note('emil'), note('gitlab', { system: true }))], 1],
    [
      'top-level before head commit',
      [thread(note('bot', { resolvable: false, at: '2026-10-08T20:30:17Z' }))],
      0
    ],
    [
      'top-level after head commit',
      [thread(note('bot', { resolvable: false, at: '2026-10-08T20:40:00Z' }))],
      1
    ],
    [
      'top-level I replied to',
      [
        thread(
          note('bot', { resolvable: false, at: '2026-10-08T20:40:00Z' }),
          note('me', { resolvable: false })
        )
      ],
      0
    ]
  ] as [string, GitLabDiscussion[], number][])('%s', (_name, discussions, want) => {
    expect(waitingThreads(discussions, 'me', HEAD)).toBe(want)
  })
})

describe('readWaitingThreads', () => {
  it('pages the discussions and compares with the head commit time', async () => {
    const api = fakeGlab((path) => {
      if (path === 'merge_requests/7/discussions?per_page=100&page=1') {
        return [thread(note('bot', { resolvable: false, at: '2026-10-08T20:40:00Z' }))]
      }
      if (path === 'repository/commits/abc') {
        return { committed_date: '2026-10-08T13:36:51-07:00' }
      }
      return undefined
    })
    expect(await readWaitingThreads(sourceContext(), api, 7, 'me', 'abc')).toBe(1)
  })

  it('fails when the head commit has no date', async () => {
    const api = fakeGlab((path) => (path.startsWith('repository/') ? {} : []))
    await expect(readWaitingThreads(sourceContext(), api, 7, 'me', 'abcdef123')).rejects.toThrow(
      'commit abcdef12 has no committed date'
    )
  })
})
