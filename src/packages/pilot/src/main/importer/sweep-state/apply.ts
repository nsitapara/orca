import { constants, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ImportCount, ImportPlan, ImportStateResult } from '../../../shared/api-types'
import type { PilotStore } from '../../store/store'
import type { StateReader, SweepStateMapper } from './types'

function count(total: number, present: number): ImportCount {
  return { total, present, added: 0 }
}

// What applying the plan would add. Writes nothing.
export function previewImport(store: PilotStore, plan: ImportPlan): ImportStateResult {
  const id = plan.automationId
  const seen = plan.seen ?? []
  const dispatched = plan.dispatched ?? []
  return {
    automationId: id,
    apply: false,
    plan,
    handled: count(
      plan.handled.length,
      plan.handled.filter((h) => store.imports.hasHandled(id, h.onceKey)).length
    ),
    seen: count(seen.length, seen.filter((s) => store.imports.hasSeen(id, s.itemKey)).length),
    sessions: count(
      plan.sessions.length,
      plan.sessions.filter((s) => store.imports.hasSession(id, s.terminalHandle)).length
    ),
    dispatched: count(
      dispatched.length,
      dispatched.filter((d) => store.imports.isDispatched(d)).length
    ),
    files: count(plan.files.length, plan.files.filter((f) => existsSync(f.to)).length)
  }
}

// An earlier import's copy is never replaced, and a missing source copies nothing.
function copyIfMissing(from: string, to: string): boolean {
  if (existsSync(to) || !existsSync(from)) {
    return false
  }
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to, constants.COPYFILE_EXCL)
  return true
}

// Only adds: never replaces a key, run, queue state or file Pilot already holds.
export function applyImport(store: PilotStore, plan: ImportPlan, now: number): ImportStateResult {
  const before = previewImport(store, plan)
  const id = plan.automationId
  const handled = store.imports.addHandled(id, plan.handled, now)
  const seen = store.imports.addSeen(id, plan.seen ?? [])
  const sessions = plan.sessions.filter((s) => store.imports.addSession(id, s, now)).length
  const dispatched = store.imports.markDispatched(plan.dispatched ?? [], now)
  const files = plan.files.filter((f) => copyIfMissing(f.from, f.to)).length
  const unmatched = before.dispatched.total - before.dispatched.present - dispatched
  const notes =
    unmatched > 0
      ? [
          ...plan.notes,
          `${unmatched} answer(s) already sent have no imported card to mark; import the open vault cards in Pilot (Inbox) first`
        ]
      : plan.notes
  return {
    ...before,
    apply: true,
    plan: { ...plan, notes },
    handled: { ...before.handled, added: handled },
    seen: { ...before.seen, added: seen },
    sessions: { ...before.sessions, added: sessions },
    dispatched: { ...before.dispatched, added: dispatched },
    files: { ...before.files, added: files }
  }
}

export function importState(
  store: PilotStore,
  mapper: SweepStateMapper,
  read: StateReader,
  apply: boolean,
  now: number
): ImportStateResult {
  const plan = mapper.plan(read)
  if (apply) {
    return applyImport(store, plan, now)
  }
  return previewImport(store, plan)
}
