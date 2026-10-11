import { describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { reposListed } from './runtime-facts'

const runtimeListing = (repos: { displayName: string; path: string }[]) =>
  ({ listRepos: () => repos }) as unknown as OrcaRuntimeService

describe('reposListed', () => {
  it.each<[string, { displayName: string; path: string }[], string[], boolean]>([
    ['by display name', [{ displayName: 'web-platform', path: '/x/wp' }], ['web-platform'], true],
    ['by folder name', [{ displayName: 'WP', path: '/x/web-platform' }], ['web-platform'], true],
    [
      'one of two missing',
      [{ displayName: 'web-platform', path: '/x/wp' }],
      ['web-platform', 'orca'],
      false
    ],
    ['nothing listed yet', [], ['web-platform'], false]
  ])('%s', (_name, repos, wanted, listed) => {
    expect(reposListed(runtimeListing(repos), wanted)).toBe(listed)
  })

  it("is false while the runtime can't list repos", () => {
    const notReady = {
      listRepos: () => {
        throw new Error('runtime_unavailable')
      }
    } as unknown as OrcaRuntimeService
    expect(reposListed(notReady, ['web-platform'])).toBe(false)
  })
})
