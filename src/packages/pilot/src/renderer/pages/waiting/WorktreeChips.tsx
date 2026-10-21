import { useAppStore } from '@/store'
import type { ItemFields } from '../../../shared/api-types'
import type { InboxGroup } from '../../../shared/inbox-groups'
import { reviewFromItemFields } from '../../activity-card/item-review'
import { useBranchLinearIssue } from '../../activity-card/linear-branch-issue'
import { WorktreeLinksPrefetch } from '../../activity-card/worktree-links'
import { LinkChips, WorktreeLinkStrip } from '../../activity-card/WorktreeLinkStrip'
import type { PilotHostRef } from '../../hosts/pilot-host'
import { usePilotHosts } from '../../hosts/pilot-hosts-feed'
import { openableWorktreeId } from './WorktreeLink'

const CHIPS_CLASS = 'shrink-0 font-sans'

function textField(fields: ItemFields, key: string): string | null {
  const value = fields[key]
  return typeof value === 'string' ? value : null
}

// What the card's run knew of its item: its MR, and the Linear issue its branch is named for.
function ItemChips({ fields }: { fields: ItemFields }): React.JSX.Element | null {
  const branch = textField(fields, 'mr.branch') ?? textField(fields, 'worktree.branch')
  const linear = useBranchLinearIssue(branch)
  return <LinkChips review={reviewFromItemFields(fields)} linear={linear} className={CHIPS_CLASS} />
}

// A card's place chips: its worktree's MR/PR, Linear and ports, as Activity's worktree header shows them. With no
// worktree in the app (an MR no worktree holds, another machine's), the MR and issue its run's item named.
export function WorktreeChips({
  group,
  host,
  fields
}: {
  group: InboxGroup
  host: PilotHostRef
  // The tick item fields of the card's run (CardRun.fields); null when it has no run or the Pilot sent none.
  fields: ItemFields | null
}): React.JSX.Element | null {
  const id = openableWorktreeId(group, host, usePilotHosts())
  const worktree = useAppStore((s) => (id ? s.getKnownWorktreeById(id) : undefined))
  const repo = useAppStore((s) => s.repos.find((r) => r.id === worktree?.repoId) ?? null)
  if (worktree) {
    return (
      <>
        <WorktreeLinksPrefetch worktree={worktree} repo={repo} />
        <WorktreeLinkStrip worktree={worktree} repo={repo} className={CHIPS_CLASS} />
      </>
    )
  }
  return fields ? <ItemChips fields={fields} /> : null
}
