import { describe, expect, it } from 'vitest'
import type { GlabApi } from '../sources/gitlab-api'
import { mrBlock } from './mr-state'

describe('mrBlock', () => {
  function api(answer: (path: string) => unknown): GlabApi & { paths: string[] } {
    const paths: string[] = []
    return {
      projectPath: 'p',
      paths,
      async get<T>(path: string): Promise<T> {
        paths.push(path)
        const value = answer(path)
        if (value instanceof Error) {
          throw value
        }
        return value as T
      }
    }
  }

  it('reads one MR by iid', async () => {
    const a = api(() => ({ iid: 1561, state: 'merged' }))
    expect(await mrBlock(a, { iid: 1561 })).toEqual({ finished: '!1561 merged' })
    expect(a.paths).toEqual(['merge_requests/1561'])
  })

  it('reads every MR of a branch, open or not', async () => {
    const a = api(() => [{ iid: 9, state: 'closed' }])
    expect(await mrBlock(a, { branch: 'web-1493/a b' })).toEqual({ finished: '!9 closed' })
    expect(a.paths).toEqual(['merge_requests?source_branch=web-1493%2Fa%20b&state=all&per_page=20'])
  })

  it('says the state is unknown when GitLab fails', async () => {
    expect(
      await mrBlock(
        api(() => new Error('glab: 502')),
        { iid: 1 }
      )
    ).toEqual({ unknown: 'MR state unknown: glab: 502' })
  })

  it.each([
    ['a body with no state', { iid: 1 }],
    ['null', null],
    ['an error object', { message: '404 Not Found' }]
  ])('does not call an MR finished from %s', async (_name, body) => {
    expect(
      await mrBlock(
        api(() => body),
        { iid: 1 }
      )
    ).toMatchObject({ unknown: expect.stringContaining('MR state unknown') })
  })

  it('does not call a branch finished from a body that is not a list', async () => {
    expect(
      await mrBlock(
        api(() => ({ message: 'x' })),
        { branch: 'b' }
      )
    ).toMatchObject({ unknown: expect.any(String) })
  })

  it('keeps an empty listing as not finished', async () => {
    expect(
      await mrBlock(
        api(() => []),
        { branch: 'b' }
      )
    ).toEqual({ finished: null })
  })

  it('does not trust a full page of a branch listing (older MRs may be cut off)', async () => {
    const page = Array.from({ length: 20 }, (_, i) => ({ iid: i + 1, state: 'merged' }))
    expect(
      await mrBlock(
        api(() => page),
        { branch: 'b' }
      )
    ).toMatchObject({ unknown: expect.stringContaining('MR state unknown') })
  })
})
