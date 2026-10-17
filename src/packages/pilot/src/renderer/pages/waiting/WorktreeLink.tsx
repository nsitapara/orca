import { ArrowUpRight } from 'lucide-react'
import { isExecutionHostAliasForWorktree } from '@/lib/worktree-execution-host-alias'
import {
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'
import type { InboxGroup } from '../../../shared/inbox-groups'
import { LOCAL_PILOT_HOST, type PilotHostRef } from '../../hosts/pilot-host'
import { currentPilotHosts, usePilotHosts } from '../../hosts/pilot-hosts-feed'
import { pilotStore, type PilotStoreState } from '../../store'

type StoreWorktree = NonNullable<PilotStoreState['worktreesByRepo']>[string][number]
type ListedHosts = readonly PilotHostRef[]

const trimmed = (path: string): string => path.replace(/\/+$/, '')

// The execution host another machine's worktrees are owned by; none for this machine.
function remoteExecutionHost(host: PilotHostRef): ExecutionHostId | null {
  const { target } = host
  return target.kind === 'environment' ? toRuntimeExecutionHostId(target.environmentId) : null
}

// A remote machine's worktrees name it (owner environment or host id alias). This machine's are the rest that no
// other listed Pilot owns: none, or (in the browser, where this machine is the page's server) its environment.
function worktreesOn(host: PilotHostRef, hosts: ListedHosts): StoreWorktree[] {
  const all = Object.values(pilotStore()?.getState().worktreesByRepo ?? {}).flat()
  const own = remoteExecutionHost(host)
  if (own) {
    return all.filter((w) => isExecutionHostAliasForWorktree(own, w))
  }
  const others = hosts.flatMap((h) => remoteExecutionHost(h) ?? [])
  return all.filter((w) => !others.some((other) => isExecutionHostAliasForWorktree(other, w)))
}

export function isWorktreeGroup(group: InboxGroup): boolean {
  return group.key.startsWith('wt:')
}

// The app's id for a worktree group's worktree on the group's machine, or null when the group is not a worktree
// or the app does not have it there. An id an item key named is used when that machine's worktrees have it;
// otherwise the worktree is looked up by its path (no id format is guessed).
export function openableWorktreeId(
  group: InboxGroup,
  host: PilotHostRef = LOCAL_PILOT_HOST,
  hosts: ListedHosts = currentPilotHosts()
): string | null {
  if (!isWorktreeGroup(group)) {
    return null
  }
  if (group.worktreeId && worktreesOn(host, hosts).some((w) => w.id === group.worktreeId)) {
    return group.worktreeId
  }
  return worktreeIdForPath(group.key.slice('wt:'.length), host, hosts)
}

// The app's id for the worktree at this path on that machine, or null when the app does not have it there.
export function worktreeIdForPath(
  path: string,
  host: PilotHostRef = LOCAL_PILOT_HOST,
  hosts: ListedHosts = currentPilotHosts()
): string | null {
  return worktreesOn(host, hosts).find((w) => trimmed(w.path) === trimmed(path))?.id ?? null
}

// The display name of the project the app lists this worktree under, or null when the app does not have it.
export function repoNameForPath(path: string): string | null {
  const state = pilotStore()?.getState()
  const listed = Object.entries(state?.worktreesByRepo ?? {}).find(([, worktrees]) =>
    worktrees.some((w) => trimmed(w.path) === trimmed(path))
  )
  if (!listed) {
    return null
  }
  return state?.repos?.find((r) => r.id === listed[0])?.displayName ?? null
}

// The same activation the worktree palette makes, loaded when used so the page does not pull the app in. A bare id
// can name a worktree on two machines, so another machine's opens on its own execution host.
export function openWorktree(id: string, host: PilotHostRef = LOCAL_PILOT_HOST): void {
  const executionHostId = remoteExecutionHost(host)
  void import('@/lib/worktree-activation').then((m) => {
    if (executionHostId) {
      m.activateAndRevealWorktree(id, { executionHostId })
      return
    }
    m.activateAndRevealWorktree(id)
  })
}

// A section heading's worktree name: a link that opens the worktree, plain text when the app does not have it.
export function WorktreeName({
  group,
  host
}: {
  group: InboxGroup
  // The section's machine; none is this machine.
  host?: PilotHostRef
}): React.JSX.Element {
  // Subscribed, so a change to the listed machines re-sorts whose worktree this is.
  const id = openableWorktreeId(group, host, usePilotHosts())
  if (!isWorktreeGroup(group)) {
    return <span className="text-foreground">{group.label}</span>
  }
  if (!id) {
    return (
      <span className="text-foreground" title="Not open in Pilot">
        {group.label}
      </span>
    )
  }
  return (
    <button
      type="button"
      title="Open this worktree"
      onClick={() => openWorktree(id, host)}
      className="inline-flex items-center gap-1 text-foreground hover:underline"
    >
      {group.label}
      <ArrowUpRight aria-hidden className="size-3 text-muted-foreground" />
    </button>
  )
}

// The small open button beside a group's name in the card list; none unless the app has the worktree.
export function OpenWorktreeButton({
  group,
  host
}: {
  group: InboxGroup
  host?: PilotHostRef
}): React.JSX.Element | null {
  const id = openableWorktreeId(group, host, usePilotHosts())
  if (!id) {
    return null
  }
  return (
    <button
      type="button"
      aria-label={`Open ${group.label} in Pilot`}
      title="Open this worktree"
      onClick={() => openWorktree(id, host)}
      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
    >
      <ArrowUpRight aria-hidden className="size-3" />
    </button>
  )
}
