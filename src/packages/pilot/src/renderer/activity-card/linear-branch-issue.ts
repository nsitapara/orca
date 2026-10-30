import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { getLinearReadScope, scopedLinearCacheKey } from '@/store/slices/linear/linear-slice-scope'
import type { WorktreeLinearLink } from './worktree-links'

// Linear names a branch for its issue: "web-2153-create-…", or "nish/web-2153-…".
const BRANCH_ISSUE = /^([a-z][a-z0-9]*-\d+)(?:-|$)/i

// The Linear issue id a branch is named for, or null when its name starts with none.
export function linearIdOfBranch(branch: string): string | null {
  const name =
    branch
      .replace(/^refs\/heads\//, '')
      .split('/')
      .at(-1) ?? ''
  return BRANCH_ISSUE.exec(name)?.[1].toUpperCase() ?? null
}

/**
 * The Linear issue a branch is named for, fetched once (the store dedupes and caches it). Null until Linear returns
 * that issue, so a branch whose name only looks like an id ("release-2026-…") never shows one.
 */
export function useBranchLinearIssue(branch: string | null | undefined): WorktreeLinearLink | null {
  return useLinearIssue(branch ? linearIdOfBranch(branch) : null)
}

/** A Linear issue by its id ("WEB-2153"), fetched once; null until Linear returns it. */
export function useLinearIssue(identifier: string | null | undefined): WorktreeLinearLink | null {
  const id = identifier ? identifier.toUpperCase() : null
  const settings = useAppStore((s) => s.settings)
  const fetchLinearIssue = useAppStore((s) => s.fetchLinearIssue)
  // The key fetchLinearIssue(id) writes with no workspace named.
  const key = id ? scopedLinearCacheKey(getLinearReadScope(settings), `selected::${id}`) : ''
  const issue = useAppStore((s) => (key ? s.linearIssueCache[key]?.data : undefined))
  useEffect(() => {
    if (id) {
      void fetchLinearIssue(id).catch(() => null)
    }
  }, [id, fetchLinearIssue])
  if (!issue || issue.identifier.toUpperCase() !== id) {
    return null
  }
  return {
    identifier: issue.identifier,
    title: issue.title,
    stateName: issue.state?.name,
    stateType: issue.state?.type,
    stateColor: issue.state?.color,
    url: issue.url
  }
}
