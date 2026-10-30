import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { linearIdOfBranch } from '../activity-card/linear-branch-issue'
import { worktreeParentOf } from '../activity-tabs/worktree-nest-parent'

export type TicketNode = { ticket: string; children: string[] }

/** The tickets as parents with their sub-issues under them, where a ticket's parent is known and listed too. */
export function ticketTree(
  tickets: readonly string[],
  parentOf: (ticket: string) => string | null
): TicketNode[] {
  const listed = new Set(tickets)
  const parentIn = (ticket: string): string | null => {
    const parent = parentOf(ticket)
    return parent && parent !== ticket && listed.has(parent) ? parent : null
  }
  return tickets
    .filter((ticket) => parentIn(ticket) === null)
    .map((ticket) => ({ ticket, children: tickets.filter((t) => parentIn(t) === ticket) }))
}

/**
 * Each ticket's parent ticket, as Orca's worktree lineage knows it: a child worktree's branch names the sub-issue,
 * its parent worktree's branch the parent. Worktrees removed since are unknown, so their tickets stay top-level.
 */
export function useTicketParents(): (ticket: string) => string | null {
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const worktreeLineageById = useAppStore((s) => s.worktreeLineageById)
  return useMemo(() => {
    const parentOf = worktreeParentOf({ worktreesByRepo, worktreeLineageById })
    const all = Object.values(worktreesByRepo).flat()
    const byId = new Map(all.map((w) => [w.id, w]))
    const parents = new Map<string, string>()
    for (const worktree of all) {
      const ticket = worktree.branch ? linearIdOfBranch(worktree.branch) : null
      const parent = ticket ? parentOf(worktree.id) : null
      const parentBranch = parent ? byId.get(parent.id)?.branch : undefined
      const parentTicket = parentBranch ? linearIdOfBranch(parentBranch) : null
      if (ticket && parentTicket) {
        parents.set(ticket, parentTicket)
      }
    }
    return (ticket: string) => parents.get(ticket.toUpperCase()) ?? null
  }, [worktreesByRepo, worktreeLineageById])
}
