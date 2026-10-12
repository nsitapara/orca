import type { ImportPlan } from '../../../shared/api-types'
import type { SweepStateMapper } from './types'

export function emptyPlan(automationId: string, notes: string[] = []): ImportPlan {
  return { automationId, handled: [], sessions: [], files: [], notes }
}

// For a job whose old version kept nothing the engine needs: importing it just says so.
export function noStateMapper(automationId: string, why: string): SweepStateMapper {
  return { automationId, plan: () => emptyPlan(automationId, [why]) }
}
