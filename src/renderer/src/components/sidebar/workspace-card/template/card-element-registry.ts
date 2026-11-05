import type { WorktreeCardController } from '../controller/use-worktree-card-controller'
import { CARD_ACTIVITY_PARTS } from './card-activity-parts'
import { CARD_IDENTITY_PARTS } from './card-identity-parts'
import { CARD_PRIMITIVES } from './card-primitives'
import type { CardElementRegistry } from './card-template-compiler'
import { PILOT_CARD_PARTS } from '../../../../../../packages/pilot/src/renderer/artifacts/projects-card-artifacts-part' // pilot-hook: projects-card-artifacts

/** Every element a card template can name: layout and text primitives plus Orca's own parts. */
export const WORKSPACE_CARD_ELEMENTS: CardElementRegistry<WorktreeCardController> = {
  ...CARD_PRIMITIVES,
  ...CARD_IDENTITY_PARTS,
  ...CARD_ACTIVITY_PARTS,
  ...PILOT_CARD_PARTS // pilot-hook: projects-card-artifacts
}
