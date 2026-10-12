import type { ImportedHandled } from '../../../shared/api-types'
import { tabSessions } from './tabs'
import type { SweepStateMapper } from './types'

const HANDLED = 'ci-fix/handled.json'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// handled.json is gate.save's { "<iid>": <pipeline id> }: the pipelines a session already tried. Each becomes
// fix-failed-ci's once_per key "<iid>:<pipeline>", so the engine never retries one (scripts/seed-handled-from-sweep.mjs).
function handledKeys(data: unknown): { handled: ImportedHandled[]; notes: string[] } {
  const handled: ImportedHandled[] = []
  const notes: string[] = []
  if (data !== null && !isRecord(data)) {
    return { handled, notes: [`${HANDLED}: expected { "<iid>": <pipeline id> }`] }
  }
  for (const [iid, pipeline] of Object.entries(isRecord(data) ? data : {})) {
    if (/^\d+$/.test(iid) && Number.isSafeInteger(pipeline) && (pipeline as number) > 0) {
      handled.push({ onceKey: `${iid}:${pipeline}`, status: 'done' })
    } else {
      notes.push(`${HANDLED}: skipped ${iid}: ${JSON.stringify(pipeline)}`)
    }
  }
  return { handled, notes }
}

export const fixFailedCiState: SweepStateMapper = {
  automationId: 'fix-failed-ci',
  plan(read) {
    const { handled, notes } = handledKeys(read.json(HANDLED))
    const tabs = tabSessions(read, 'ci-fix')
    return {
      automationId: 'fix-failed-ci',
      handled,
      sessions: tabs.sessions,
      files: [],
      notes: [...notes, ...tabs.notes]
    }
  }
}
