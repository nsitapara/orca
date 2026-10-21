import type { FieldValue, ItemFields } from '../../shared/api-types'
import type { PreparationFor } from '../../shared/api-types-runs'
import { PreparationInputSchema, type PreparationRequirement } from '../../shared/preparation'
import type { PilotStore } from '../store/store'

const NEEDS = PreparationInputSchema.shape.requirements.element.options

function text(value: FieldValue | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

// inboxPreparationSource joins the needs with commas; an unknown word is dropped.
function needsOf(value: FieldValue | undefined): PreparationRequirement[] {
  const words = text(value)?.split(',') ?? []
  return words.flatMap((word) => NEEDS.filter((need) => need === word.trim()))
}

// What a context-preparation run prepares, from its tick item's preparation.* fields (inbox-preparations.ts); null for
// any other run. The card is read now for its title and how many tries it gets.
export function preparationFor(
  store: PilotStore,
  fields: ItemFields,
  nameOf: (automationId: string) => string
): PreparationFor | null {
  const cardId = text(fields['preparation.item_id'])
  if (!cardId) {
    return null
  }
  const card = store.inbox.get(cardId)
  const origin = text(fields['preparation.origin_automation'])
  const attempt = fields['preparation.attempt']
  return {
    cardId,
    cardTitle: card?.title ?? null,
    askedBy: origin ? nameOf(origin) : null,
    askedInRun: text(fields['preparation.origin_run']),
    needs: needsOf(fields['preparation.requirements']),
    attempt: typeof attempt === 'number' ? attempt : 1,
    maxAttempts: card?.preparation?.maxAttempts ?? null,
    lastError: text(fields['preparation.error'])
  }
}
