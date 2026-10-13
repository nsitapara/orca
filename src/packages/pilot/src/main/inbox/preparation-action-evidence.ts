import type { InboxItemRow } from '../../shared/api-types'
import type { DetailsSnapshot } from '../../shared/details'
import { ReviewFileSchema } from './details-schema'

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

// The preview and the action must refer to the same pinned bytes, including head and comment bodies.
export function validatePreparationAction(item: InboxItemRow, snapshot: DetailsSnapshot): string[] {
  if (item.action === 'push') {
    return validatePushEvidence(item, snapshot)
  }
  if (item.action !== 'post_review') {
    return []
  }
  const args = item.actionArgs?.argv
  const reviews = snapshot.bundle.blocks.filter((block) => block.type === 'review')
  if (
    !Array.isArray(args) ||
    args.length !== 3 ||
    !args.every((arg) => typeof arg === 'string') ||
    reviews.length !== 1
  ) {
    return ['Post review requires the exact pinned review artifact']
  }
  const block = reviews[0]
  const hash = snapshot.ref.inlined[block.file]
  if (!hash || hash !== args[2]) {
    return ['Prepared review does not match the review bytes this action will post']
  }
  try {
    const review = ReviewFileSchema.parse(JSON.parse(snapshot.texts[block.file]))
    if (String(review.iid) !== args[0]) {
      return ['Prepared review targets a different merge request']
    }
    const ids = review.parts.map((part) => part.id).sort()
    const expected = Object.keys(item.parts).sort()
    if (new Set(ids).size !== ids.length || JSON.stringify(ids) !== JSON.stringify(expected)) {
      return ['Prepared review findings do not match this action’s selectable parts']
    }
  } catch {
    return ['Prepared review is not a valid publishable artifact']
  }
  return []
}
