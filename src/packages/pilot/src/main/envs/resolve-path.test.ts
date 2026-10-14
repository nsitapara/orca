import { describe, expect, it } from 'vitest'
import { resolveEnvPath, type WorktreeRuntime } from './resolve-path'

// A runtime that lists the folder from the `listedOn`-th look on, and a clock each sleep moves on.
function setup(listedOn: number) {
  const seen: string[] = []
  let looks = 0
  const runtime: WorktreeRuntime = {
    invalidateWorktreeCatalog: (repoId) => void seen.push(`invalidate ${repoId}`),
    showManagedWorktree: async (selector) => {
      looks += 1
      seen.push(`show ${selector}`)
      if (looks < listedOn) {
        throw new Error('selector_not_found')
      }
      return { id: 'repo::/agents/agents-ci-1', git: { path: '/agents/agents-ci-1' } }
    }
  }
  const time = { now: 0 }
  const clock = {
    now: () => time.now,
    sleep: async (ms: number) => {
      time.now += ms
    },
    timeoutMs: 3000
  }
  return { seen, runtime, clock }
}

describe('resolving the env folder in Pilot’s own runtime', () => {
  it.each([
    [
      'listed on the third look: each look rescans the repo first',
      3,
      { id: 'repo::/agents/agents-ci-1', path: '/agents/agents-ci-1' },
      3
    ],
    [
      'never listed: gives up at the deadline',
      Number.POSITIVE_INFINITY,
      "Pilot's runtime didn't list /agents/agents-ci-1 within 3s",
      4
    ]
  ])('%s', async (_name, listedOn, expected, looks) => {
    const t = setup(listedOn)
    // What it resolved to, or the message it gave up with.
    const outcome = await resolveEnvPath(
      t.runtime,
      'repo',
      '/agents/agents-ci-1',
      new AbortController().signal,
      t.clock
    ).then(
      (found) => found,
      (error: Error) => error.message
    )
    expect(outcome).toEqual(expected)
    const look = ['invalidate repo', 'show path:/agents/agents-ci-1']
    expect(t.seen).toEqual(Array.from({ length: looks }, () => look).flat())
  })

  it('stops looking once its run is stopped', async () => {
    const t = setup(Number.POSITIVE_INFINITY)
    const controller = new AbortController()
    controller.abort()
    await expect(
      resolveEnvPath(t.runtime, 'repo', '/agents/agents-ci-1', controller.signal, t.clock)
    ).rejects.toThrow('stopped while it was being made')
  })
})
