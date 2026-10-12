import type { GlabApi } from './gitlab-api'
import type { SourceContext } from './types'

export const PER_PAGE = 100
export const MAX_PAGES = 10

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// The pass's one GitLab client for this repo (spec §4): its `get` and `getRoot` are memoized per
// project and path, so automations of one pass fetch a path once.
export function gitlabFor(ctx: SourceContext): Promise<GlabApi> {
  return ctx.fetch.gitlab(ctx.repo.path)
}

// gate.glab_all: pages of 100 until a short page, at most MAX_PAGES; `capped` says there may be more.
// Each page is read through <api>, so the pass client memoizes it. An answer that isn't a list fails.
export async function readPages<T>(
  api: GlabApi,
  path: string
): Promise<{ items: T[]; capped: boolean }> {
  const sep = path.includes('?') ? '&' : '?'
  const items: T[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await api.get<unknown>(`${path}${sep}per_page=${PER_PAGE}&page=${page}`)
    if (!Array.isArray(batch)) {
      throw new Error(`GitLab didn't answer ${path} with a list`)
    }
    items.push(...(batch as T[]))
    if (batch.length < PER_PAGE) {
      return { items, capped: false }
    }
  }
  return { items, capped: true }
}

// readPages, with the whole listing memoized in the pass too, so a second reader skips the page loop.
export function pageAll<T>(
  ctx: SourceContext,
  api: GlabApi,
  path: string
): Promise<{ items: T[]; capped: boolean }> {
  return ctx.fetch.memo(`glab-pages:${api.projectPath}:${path}`, () => readPages<T>(api, path))
}

// GitLab's MR states, in the words Pilot's fields use.
export const MR_STATE: Readonly<Record<string, string>> = {
  opened: 'open',
  merged: 'merged',
  closed: 'closed',
  locked: 'locked'
}
