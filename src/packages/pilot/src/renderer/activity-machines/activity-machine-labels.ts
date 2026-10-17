import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import {
  getWorktreeExecutionHostId,
  type ExecutionHostId
} from '../../../../../shared/execution-host'
import { indexExecutionHostsById } from '../../../../../shared/managed-orcad-execution-host'
import { getMixedHostContextLabels } from '../../../../../shared/worktree/host-context-labels'
import type { SidebarHostOption } from '@/components/sidebar/sidebar-host-options'

export type ActivityMachineRow = {
  worktree: Pick<Worktree, 'hostId'>
  repo: Pick<Repo, 'connectionId' | 'executionHostId'> | null
}

export type ActivityMachineHost = Pick<
  SidebarHostOption,
  'id' | 'label' | 'aliasHostIds' | 'mergedIntoHostId'
>

// Same precedence as threadMatchesActivityScope.
export function getActivityRowHostId(
  row: ActivityMachineRow,
  defaultHostId: ExecutionHostId
): ExecutionHostId {
  return getWorktreeExecutionHostId(row.worktree, row.repo ?? undefined, defaultHostId)
}

/** Label per raw host id, or null while the rows sit on one machine. */
export function buildActivityMachineLabels(args: {
  rows: Iterable<ActivityMachineRow>
  defaultHostId: ExecutionHostId
  hosts: readonly ActivityMachineHost[]
}): ReadonlyMap<string, string> | null {
  const ids = new Set<ExecutionHostId>()
  for (const row of args.rows) {
    ids.add(getActivityRowHostId(row, args.defaultHostId))
  }
  const byId = indexExecutionHostsById(args.hosts)
  const labels = getMixedHostContextLabels([...ids], {
    // Why: a merged-away id and its machine's id are one machine.
    getHostId: (id) => byId.get(id)?.id ?? id,
    getIdentity: (id) => id,
    sources: { hostLabelById: new Map(args.hosts.map((host) => [host.id, host.label])) }
  })
  return labels ?? null
}
