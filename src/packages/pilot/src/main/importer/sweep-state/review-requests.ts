import type { ImportedHandled } from '../../../shared/api-types'
import type { SweepStateMapper } from './types'

const FOLDER = '09 · Prepare reviews requested of me'
const NOT_CARD_NOTES = new Set([`${FOLDER}.md`, 'Runs.md', 'Closed sessions.md'])
// vault.ITEM's head: "- [ ] **action** · <summary> — `<location>`"
const ITEM = /^- \[([ xX])\] \*\*[a-z_]+(?: · [a-z]+)?\*\* · (.+?) — `([^`]*)`/
const PREPARE = /^Prepare a review of !(\d+)\?$/
const HEAD = /@([0-9a-f]{8})$/

function merge(into: Map<string, ImportedHandled>, h: ImportedHandled): void {
  if (into.get(h.onceKey)?.status !== 'done') {
    into.set(h.onceKey, h)
  }
}

function statusOf(mark: string): ImportedHandled['status'] {
  if (mark === ' ') {
    return 'started'
  }
  return 'done'
}

// Every Prepare card in one note, as review-requests' once_per key "<iid>:<head8>". A ticked card (prepared,
// skipped, stale, obsolete) is done; an open one was offered and waits on me (started). Post cards aren't keys.
export function preparedKeys(markdown: string): ImportedHandled[] {
  const found = new Map<string, ImportedHandled>()
  for (const line of markdown.split('\n')) {
    const item = ITEM.exec(line)
    const iid = item ? PREPARE.exec(item[2]) : null
    const head = item ? HEAD.exec(item[3]) : null
    if (item && iid && head) {
      merge(found, { onceKey: `${iid[1]}:${head[1]}`, status: statusOf(item[1]) })
    }
  }
  return [...found.values()]
}

// sweep.py's "handled" was any item with the card's key in the job's notes, open or ticked: Items.md and the
// branch notes. Each head offered before the cutover becomes a handled key, so it is never offered again.
export const reviewRequestsState: SweepStateMapper = {
  automationId: 'review-requests',
  plan(read) {
    const keys = new Map<string, ImportedHandled>()
    for (const name of read.notes(FOLDER).filter((n) => !NOT_CARD_NOTES.has(n))) {
      for (const h of preparedKeys(read.note(`${FOLDER}/${name}`) ?? '')) {
        merge(keys, h)
      }
    }
    return {
      automationId: 'review-requests',
      handled: [...keys.values()],
      sessions: [],
      files: [],
      notes: [
        'Open Prepare and Post cards move into the inbox with Task 27; their heads are marked handled here'
      ]
    }
  }
}
