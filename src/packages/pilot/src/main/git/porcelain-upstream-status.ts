import type { GitUpstreamStatus } from '../../../../../shared/git-status-types'

// Why: porcelain v2 drops `# branch.ab` only when the upstream ref is gone (deleted on the remote,
// then pruned). Upstream counts that as 0/0, so the branch reads "up to date" while its commits are
// on no remote. No upstream, as the explicit upstream reader says, offers Publish Branch instead.
export function porcelainUpstreamStatus(
  upstreamName: string | undefined,
  upstreamAheadBehind: { ahead: number; behind: number } | undefined
): GitUpstreamStatus {
  if (!upstreamName || !upstreamAheadBehind) {
    return { hasUpstream: false, ahead: 0, behind: 0 }
  }
  return { hasUpstream: true, upstreamName, ...upstreamAheadBehind }
}
