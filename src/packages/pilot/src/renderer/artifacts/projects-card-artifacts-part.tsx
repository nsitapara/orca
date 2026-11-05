import type { WorktreeCardController } from '../../../../../renderer/src/components/sidebar/workspace-card/controller/use-worktree-card-controller'
import { cardElement } from '../../../../../renderer/src/components/sidebar/workspace-card/template/card-template-compiler'
import { ProjectsCardArtifactsChip } from './WorktreeArtifactsChip'

// Hook target: workspace-card/template/card-element-registry.ts and default-workspace-card.json
// (pilot-hook: projects-card-artifacts). The template names it right above the children chip.
export const PILOT_CARD_PARTS = {
  PilotArtifactsChip: cardElement<WorktreeCardController>([], (_props, _children, card) => (
    <ProjectsCardArtifactsChip worktree={card.worktree} />
  ))
}
