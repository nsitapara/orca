import type { ItemFields, ScopeResult } from '../api-types'
import type { PipelineWhere } from '../definition/types'
import { IN_SCOPE, notDue, numberOf } from './scope-helpers'

// 13's "green": a newest run without a real failure is not due; the next red one is.
export function pipelineScope(f: ItemFields, w: PipelineWhere): ScopeResult {
  if (w.status !== 'failed' || (numberOf(f['pipeline.failed_count']) ?? 0) > 0) {
    return IN_SCOPE
  }
  return notDue(`Pipeline ${String(f['pipeline.id'])} passed`)
}
