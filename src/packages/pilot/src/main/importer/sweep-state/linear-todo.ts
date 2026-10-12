import type { ImportedHandled } from '../../../shared/api-types'
import { emptyPlan } from './plans'
import type { SweepStateMapper } from './types'

const STARTED = 'linear-todo/started.json'

// M01's started.json, { "<ID>": { path, handle, startedAt } }: every kicked-off ticket is handled under
// linear-todo.yaml's once_per "{ticket.id}", so Pilot never kicks it off again.
export const linearTodoMapper: SweepStateMapper = {
  automationId: 'linear-todo',
  plan(read) {
    const data = read.json(STARTED)
    if (data !== null && (typeof data !== 'object' || Array.isArray(data))) {
      return emptyPlan('linear-todo', [`${STARTED}: expected a JSON object`])
    }
    const handled: ImportedHandled[] = []
    for (const [ident, entry] of Object.entries((data ?? {}) as Record<string, unknown>)) {
      const startedAt = (entry as { startedAt?: unknown } | null)?.startedAt
      const at = typeof startedAt === 'string' ? Date.parse(startedAt) : Number.NaN
      handled.push({
        onceKey: ident,
        status: 'done',
        at: Number.isNaN(at) ? read.now : at,
        failedAt: null
      })
    }
    return { ...emptyPlan('linear-todo', []), handled }
  }
}
