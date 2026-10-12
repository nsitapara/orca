import type { PeopleDirectory } from '../../../shared/people'
import { createPassFetchCache } from '../fetch-cache'
import type { GlabApi } from '../gitlab-api'
import type { SourceContext } from '../types'

export const PEOPLE: PeopleDirectory = {
  people: [
    { id: 'nish', name: 'Nish Sitapara', gitlab: 'nish8', github: 'nsitapara', linear: 'Nish' },
    { id: 'emil', name: 'Emil Elgaard', gitlab: 'shivan2418' },
    { id: 'jonathan', name: 'Jonathan Walker', gitlab: 'jonathan.walker2' },
    { id: 'alex', name: 'Alex Craig', gitlab: 'alex1craig' }
  ],
  groups: [{ id: 'web', name: 'Web team', members: ['nish', 'emil', 'jonathan', 'alex'] }]
}

export const NOW = Date.parse('2026-10-11T12:00:00Z')

// A source context over Task 4b's real pass cache, so memoizing is what production does: reads of
// `ctx.fetch.gitlab(ctx.repo.path)` reach <glab> once per path. A fresh call is a fresh pass.
export function sourceContext(
  over: Partial<SourceContext> = {},
  glab: GlabApi = fakeGlab(() => undefined)
): SourceContext {
  return {
    repo: { id: 'repo1', name: 'web-platform', path: '/repo', base: null },
    people: PEOPLE,
    fetch: createPassFetchCache('test', async () => glab),
    now: NOW,
    automationId: 'auto',
    ...over
  }
}

export type FakeGlab = GlabApi & { calls: string[] }

// A GlabApi answering from <answer>: the parsed JSON for a path, an Error to fail that call, or
// undefined (no such route: also a failure). Root paths (`user`) arrive as `root:<path>`.
export function fakeGlab(
  answer: (path: string) => unknown,
  projectPath = 'polygenx/web-platform'
): FakeGlab {
  const calls: string[] = []
  async function respond<T>(path: string): Promise<T> {
    calls.push(path)
    const value = answer(path)
    if (value instanceof Error) {
      throw value
    }
    if (value === undefined) {
      throw new Error(`no fake GitLab answer for ${path}`)
    }
    return value as T
  }
  return {
    calls,
    projectPath,
    get: <T>(path: string) => respond<T>(path),
    getRoot: <T>(path: string) => respond<T>(`root:${path}`)
  }
}
