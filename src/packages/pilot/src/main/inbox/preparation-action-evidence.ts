import type { InboxItemRow } from '../../shared/api-types'
import type { DetailsSnapshot } from '../../shared/details'

// A push's evidence is the exact range it publishes: every diff is the committed range from the origin commit it
// must fast-forward to the head it pushes. The catalog's push argv is [<worktree path>, <branch>, <commit>, <origin
// commit>] (act.py push), so the head is argv[2] and the base argv[3].
function validatePushEvidence(item: InboxItemRow, snapshot: DetailsSnapshot): string[] {
  const argv = item.actionArgs?.argv
  if (!Array.isArray(argv) || argv.length !== 4 || !argv.every((arg) => typeof arg === 'string')) {
    return ['Push requires its pinned commit and origin commit']
  }
  const [, , head, base] = argv as string[]
  const diffs = snapshot.bundle.blocks.filter((block) => block.type === 'diff')
  const pinned = (block: (typeof diffs)[number]) =>
    block.patch_kind === 'committed' && block.head === head && block.base === base
  if (diffs.length === 0 || !diffs.every(pinned)) {
    return [`Prepared diff is not the pushed range ${base.slice(0, 8)}..${head.slice(0, 8)}`]
  }
  return []
}

// The preview and the action must refer to the same pinned bytes: a push's head and base.
export function validatePreparationAction(item: InboxItemRow, snapshot: DetailsSnapshot): string[] {
  return item.action === 'push' ? validatePushEvidence(item, snapshot) : []
}
