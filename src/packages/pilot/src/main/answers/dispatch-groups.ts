import type { InboxItemRow, QueueRow } from '../../shared/api-types'
import type { MrBlock } from '../inbox/mr-state'
import { retireTarget } from '../inbox/retire'
import type { PilotStore } from '../store/store'
import { hold, type Hold } from './holds'

export type Entry = { row: QueueRow; item: InboxItemRow }
export type Group = { automationId: string; worktreePath: string | null; entries: Entry[] }

const UNREAD_MR = "MR state unknown: it hasn't been read yet"

// Answers past their settle (or a not-yet recheck), grouped like apply.py's notes: one automation, one
// worktree. A row whose card no longer waits on an answer has nothing left to dispatch.
export function dueGroups(store: PilotStore, at: number): Group[] {
  const groups = new Map<string, Group>()
  for (const row of store.queue.list(['not_ready', 'ready', 'held'])) {
    if (row.readyAt > at) {
      continue
    }
    const item = store.inbox.get(row.inboxItemId)
    if (!item || item.status !== 'answered') {
      const words = `the card is ${item?.status ?? 'gone'}`
      store.queue.update(row.id, { state: 'failed', ...hold('retry', words) }, at)
      continue
    }
    // Picked up for application: ready from here on, and so locked (a held row too). A hold that applies
    // again puts it back to held.
    if (row.state === 'not_ready' || row.state === 'held') {
      store.queue.update(row.id, { state: 'ready' }, at)
    }
    const key = `${item.automationId}|${item.worktreePath ?? ''}`
    const group = groups.get(key) ?? {
      automationId: item.automationId,
      worktreePath: item.worktreePath,
      entries: []
    }
    group.entries.push({ row, item })
    groups.set(key, group)
  }
  return [...groups.values()]
}

// Why the group's MR stops it (GitLab couldn't say, or hasn't been asked yet), or null, and the entries
// still to apply. A card whose MR is finished was retired at the start of the pass; one the retirer
// couldn't close is left to it.
export function mrHold(
  store: PilotStore,
  retirer: { blockFor(item: InboxItemRow): MrBlock | null },
  entries: Entry[]
): { hold: Hold | null; open: Entry[] } {
  const open: Entry[] = []
  for (const entry of entries) {
    const block = retirer.blockFor(entry.item)
    if (block === null && retireTarget(store, entry.item) !== null) {
      return { hold: hold('mr_unknown', UNREAD_MR), open: [] }
    }
    if (block && 'unknown' in block) {
      return { hold: hold('mr_unknown', block.unknown), open: [] }
    }
    if (!block?.finished) {
      open.push(entry)
    }
  }
  return { hold: null, open }
}
