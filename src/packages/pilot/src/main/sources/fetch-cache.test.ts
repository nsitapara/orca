import { describe, expect, it, vi } from 'vitest'
import { createPassFetchCache } from './fetch-cache'
import type { GlabApi } from './gitlab-api'

function counting(): { api: GlabApi; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    api: {
      projectPath: 'group/web-platform',
      async get<T>(path: string): Promise<T> {
        calls.push(path)
        return { path } as T
      }
    }
  }
}

describe('createPassFetchCache', () => {
  it('fetches each GitLab path once per pass, for every client of the repo', async () => {
    const { api, calls } = counting()
    const factory = vi.fn(async () => api)
    const pass = createPassFetchCache('pass-1', factory)
    const one = await pass.gitlab('/repo')
    const two = await pass.gitlab('/repo')
    expect(await one.get('merge_requests/1')).toEqual({ path: 'merge_requests/1' })
    await two.get('merge_requests/1')
    await two.get('merge_requests/2')
    expect(calls).toEqual(['merge_requests/1', 'merge_requests/2'])
    expect(factory).toHaveBeenCalledTimes(1)
    expect(one.projectPath).toBe('group/web-platform')
  })

  it('shares one request between readers that ask at the same time', async () => {
    const { api, calls } = counting()
    const glab = await createPassFetchCache('pass-1', async () => api).gitlab('/repo')
    await Promise.all([glab.get('x'), glab.get('x')])
    expect(calls).toEqual(['x'])
  })

  it('drops a failed request, so the next reader in the pass tries again', async () => {
    let failures = 1
    const api: GlabApi = {
      projectPath: 'group/web-platform',
      async get<T>(): Promise<T> {
        if (failures > 0) {
          failures -= 1
          throw new Error('glab: 502')
        }
        return 'ok' as T
      }
    }
    const glab = await createPassFetchCache('pass-1', async () => api).gitlab('/repo')
    await expect(glab.get('x')).rejects.toThrow('glab: 502')
    expect(await glab.get('x')).toBe('ok')
  })

  it('keeps passes apart, and memoizes any other read by its key', async () => {
    const { api, calls } = counting()
    const one = createPassFetchCache('pass-1', async () => api)
    const two = createPassFetchCache('pass-2', async () => api)
    await (await one.gitlab('/repo')).get('x')
    await (await two.gitlab('/repo')).get('x')
    expect(calls).toEqual(['x', 'x'])
    const load = vi.fn(async () => 42)
    expect(await one.memo('linear:{ issues }', load)).toBe(42)
    expect(await one.memo('linear:{ issues }', load)).toBe(42)
    expect(load).toHaveBeenCalledTimes(1)
    expect(one.passId).toBe('pass-1')
  })
})
