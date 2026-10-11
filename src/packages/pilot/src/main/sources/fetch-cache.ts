import type { GlabApi } from './gitlab-api'

// One per scheduler pass (contract §4): automations that read the same GitLab path or Linear query
// in a pass fetch it once. A failed read is dropped, so the next reader in the pass tries again.
// Readers share the fetched objects: never mutate one.
export type PassFetchCache = {
  readonly passId: string
  gitlab(repoPath: string): Promise<GlabApi>
  memo<T>(key: string, load: () => Promise<T>): Promise<T>
}

export function createPassFetchCache(
  passId: string,
  gitlab: (repoPath: string) => Promise<GlabApi>
): PassFetchCache {
  const entries = new Map<string, Promise<unknown>>()
  const memo = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key)
    if (hit) {
      return hit as Promise<T>
    }
    const promise = Promise.resolve().then(load)
    entries.set(key, promise)
    void promise.catch(() => {
      if (entries.get(key) === promise) {
        entries.delete(key)
      }
    })
    return promise
  }
  return {
    passId,
    memo,
    async gitlab(repoPath) {
      const api = await memo(`glab-client:${repoPath}`, () => gitlab(repoPath))
      return {
        projectPath: api.projectPath,
        get: <T>(path: string) => memo<T>(`glab:${api.projectPath}:${path}`, () => api.get<T>(path))
      }
    }
  }
}
