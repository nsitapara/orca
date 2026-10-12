import type { ImportedHandled } from '../../../shared/api-types'
import { emptyPlan } from './plans'
import type { StateReader, SweepStateMapper } from './types'

const HANDLED = 'dev-e2e/handled.json'
const TICKETS = 'dev-e2e/tickets.json'

// A sweep state file as a JSON object: {} when it doesn't exist; anything but an object is noted and read as {}.
function objectAt(read: StateReader, rel: string, notes: string[]): Record<string, unknown> {
  const value = read.json(rel)
  if (value === null) {
    return {}
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    notes.push(`${rel}: expected a JSON object`)
    return {}
  }
  return value as Record<string, unknown>
}

// 13's handled.json, { "<pipeline id>": [tickets] }: each pipeline becomes dev-e2e-fix.yaml's once_per key "<id>".
export const devE2ePipelinesMapper: SweepStateMapper = {
  automationId: 'dev-e2e-fix',
  plan(read) {
    const notes: string[] = []
    const handled: ImportedHandled[] = []
    for (const [pipeline, tickets] of Object.entries(objectAt(read, HANDLED, notes))) {
      if (!/^\d+$/.test(pipeline) || !Array.isArray(tickets)) {
        notes.push(`${HANDLED}: "${pipeline}" isn't "<pipeline id>": [tickets]; skipped`)
        continue
      }
      handled.push({ onceKey: pipeline, status: 'done', at: read.now, failedAt: null })
    }
    return { ...emptyPlan('dev-e2e-fix', notes), handled }
  }
}

// 13's tickets.json: a ticket whose session started (it has a path) is handled for dev-e2e-fix-start.yaml (once_per
// "{ticket.id}"). One without a path stays due, so Pilot starts it, as the old sweep's retry did.
export const devE2eStartsMapper: SweepStateMapper = {
  automationId: 'dev-e2e-fix-start',
  plan(read) {
    const notes: string[] = []
    const handled: ImportedHandled[] = []
    for (const [ident, entry] of Object.entries(objectAt(read, TICKETS, notes))) {
      const e = (entry ?? {}) as { path?: unknown; startedAt?: unknown }
      if (typeof e.path !== 'string' || e.path === '') {
        continue
      }
      const at = typeof e.startedAt === 'string' ? Date.parse(e.startedAt) : Number.NaN
      handled.push({
        onceKey: ident,
        status: 'done',
        at: Number.isNaN(at) ? read.now : at,
        failedAt: null
      })
    }
    return { ...emptyPlan('dev-e2e-fix-start', notes), handled }
  }
}
