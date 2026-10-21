import type { PreparationRequirement } from '../../../shared/preparation'

// What each thing a card's preparation gathers is called.
export const PREPARATION_NEED_LABELS: Record<PreparationRequirement, string> = {
  context: 'decision context',
  diff: 'code diff',
  screens: 'before / after screenshots',
  checks: 'verification results'
}
