import type { InboxItemRow } from '../../shared/api-types'
import type { DetailsSnapshot } from '../../shared/details'
import { ReviewFileSchema } from './details-schema'

// The preview and the action must refer to the same pinned bytes, including head and comment bodies.
export function validatePreparationAction(item: InboxItemRow, snapshot: DetailsSnapshot): string[] {
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
