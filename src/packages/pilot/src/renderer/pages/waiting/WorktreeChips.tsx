import { useAppStore } from '@/store'
import type { InboxGroup } from '../../../shared/inbox-groups'
import { WorktreeLinksPrefetch } from '../../activity-card/worktree-links'
import { WorktreeLinkStrip } from '../../activity-card/WorktreeLinkStrip'
import type { PilotHostRef } from '../../hosts/pilot-host'
import { usePilotHosts } from '../../hosts/pilot-hosts-feed'
import { openableWorktreeId } from './WorktreeLink'

// A worktree group's MR/PR, Linear and ports chips, as Activity's worktree header shows them; none when the app
// does not have the worktree.
export function WorktreeChips({
  group,
  host
}: {
  group: InboxGroup
  host: PilotHostRef
}): React.JSX.Element | null {
  const id = openableWorktreeId(group, host, usePilotHosts())
  const worktree = useAppStore((s) => (id ? s.getKnownWorktreeById(id) : undefined))
  const repo = useAppStore((s) => s.repos.find((r) => r.id === worktree?.repoId) ?? null)
  if (!worktree) {
    return null
  }
  return (
    <>
      <WorktreeLinksPrefetch worktree={worktree} repo={repo} />
      <WorktreeLinkStrip worktree={worktree} repo={repo} className="shrink-0 font-sans" />
    </>
  )
}
