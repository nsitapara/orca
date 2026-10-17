import { ArrowUpRight } from 'lucide-react'
import type { InboxGroup } from '../../../shared/inbox-groups'
import { pilotStore } from '../../store'

const trimmed = (path: string): string => path.replace(/\/+$/, '')

export function isWorktreeGroup(group: InboxGroup): boolean {
  return group.key.startsWith('wt:')
}

// The app's id for a worktree group's worktree, or null when the group is not a worktree or the app does not
// have it. An id an item key named is used when the store knows it; otherwise the worktree is looked up by
// its path (no id format is guessed).
export function openableWorktreeId(group: InboxGroup): string | null {
  if (!isWorktreeGroup(group)) {
    return null
  }
  const repos = pilotStore()?.getState().worktreesByRepo ?? {}
  const all = Object.values(repos).flat()
  if (group.worktreeId && all.some((w) => w.id === group.worktreeId)) {
    return group.worktreeId
  }
  return worktreeIdForPath(group.key.slice('wt:'.length))
}

// The app's id for the worktree at this path, or null when the app does not have it.
export function worktreeIdForPath(path: string): string | null {
  const all = Object.values(pilotStore()?.getState().worktreesByRepo ?? {}).flat()
  return all.find((w) => trimmed(w.path) === trimmed(path))?.id ?? null
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

// The same activation the worktree palette makes, loaded when used so the page does not pull the app in.
export function openWorktree(id: string): void {
  void import('@/lib/worktree-activation').then((m) => m.activateAndRevealWorktree(id))
}

// A section heading's worktree name: a link that opens the worktree, plain text when the app does not have it.
export function WorktreeName({ group }: { group: InboxGroup }): React.JSX.Element {
  const id = openableWorktreeId(group)
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
      onClick={() => openWorktree(id)}
      className="inline-flex items-center gap-1 text-foreground hover:underline"
    >
      {group.label}
      <ArrowUpRight aria-hidden className="size-3 text-muted-foreground" />
    </button>
  )
}

// The small open button beside a group's name in the card list; none unless the app has the worktree.
export function OpenWorktreeButton({ group }: { group: InboxGroup }): React.JSX.Element | null {
  const id = openableWorktreeId(group)
  if (!id) {
    return null
  }
  return (
    <button
      type="button"
      aria-label={`Open ${group.label} in Pilot`}
      title="Open this worktree"
      onClick={() => openWorktree(id)}
      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
    >
      <ArrowUpRight aria-hidden className="size-3" />
    </button>
  )
}
