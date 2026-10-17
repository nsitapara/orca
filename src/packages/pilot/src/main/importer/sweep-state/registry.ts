import { agentUsageState } from './agent-usage'
import { applyAnswersMapper } from './apply-answers'
import { devE2ePipelinesMapper, devE2eStartsMapper } from './dev-e2e'
import { fixFailedCiState } from './fix-failed-ci'
import { linearTodoMapper } from './linear-todo'
import { mrFeedbackState } from './mr-feedback'
import { noStateMapper } from './plans'
import { reviewBranchCodeMapper } from './review-branch-code'
import { reviewRequestsState } from './review-requests'
import type { SweepStateMapper } from './types'
import { uiQaOvernightMapper } from './ui-qa-overnight'

// One entry per ported job; each port task appends its own. Mappers import their helpers from plans.ts,
// never from here, so there is no import cycle.
export const MAPPERS: SweepStateMapper[] = [
  noStateMapper('pull-dev', '01 keeps no state: every run pulls dev again'),
  noStateMapper('docker-prune', '07 keeps no state: prune.sh measures the disk on every run'),
  agentUsageState,
  noStateMapper(
    'merge-dev',
    '02 keeps no state: its run records stay in the vault, written by the agent'
  ),
  fixFailedCiState,
  mrFeedbackState,
  reviewRequestsState,
  devE2ePipelinesMapper,
  devE2eStartsMapper,
  linearTodoMapper,
  applyAnswersMapper,
  reviewBranchCodeMapper,
  uiQaOvernightMapper,
  noStateMapper(
    'manual-memo',
    'M04 keeps its state in the repo (agent-loops/manual-memo), where its precheck reads it'
  )
]

export function sweepStateMapper(
  id: string,
  mappers: SweepStateMapper[] = MAPPERS
): SweepStateMapper | null {
  return mappers.find((m) => m.automationId === id) ?? null
}

export function sweepStateIds(mappers: SweepStateMapper[] = MAPPERS): string[] {
  return mappers.map((m) => m.automationId).sort()
}
