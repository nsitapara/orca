import type { ItemFields } from '../../shared/api-types'
import type { CheckDef } from '../../shared/definition/types'
import { endedRunTerminals } from '../run/ended-run-tabs'
import type { PilotStore } from '../store/store'
import type { Item } from '../sources/types'
import {
  listBusyTerminals,
  runtimeBusyReads,
  worktreeBusy,
  type BusyReads,
  type BusyRuntime,
  type BusyTerminal
} from './worktree-busy'

export type ActivityRuntime = {
  terminals(): Promise<BusyTerminal[]>
  reads(): BusyReads
  endedRunTerminal?(terminals: readonly BusyTerminal[]): (t: BusyTerminal) => boolean
  terminalAlive(handle: string, paneKey: string | null): Promise<boolean>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// '' idle, else gate.py's reason; a listing failure is every worktree's reason (fail closed).
async function busyFacts(
  rt: ActivityRuntime,
  paths: readonly string[],
  warnings: string[]
): Promise<Map<string, string>> {
  let terminals: BusyTerminal[]
  try {
    terminals = await rt.terminals()
  } catch (error) {
    const why = `the terminals couldn't be listed: ${messageOf(error)}`
    warnings.push(why)
    return new Map(paths.map((p) => [p, why]))
  }
  const reads = rt.reads()
  const ended = rt.endedRunTerminal?.(terminals)
  const answers = await Promise.all(paths.map((p) => worktreeBusy(p, terminals, reads, ended)))
  return new Map(paths.map((p, i) => [p, answers[i]?.reason ?? '']))
}

function activityFields(item: Item, busy: Map<string, string>): ItemFields {
  const path = item.fields['worktree.path']
  if (typeof path !== 'string') {
    return {}
  }
  const reason = busy.get(path)
  return reason === undefined ? {} : { 'worktree.busy': reason }
}

// Runs in decideTickItems after the field engine and before the decision: the runtime is asked only by
// automations with a `worktree: idle` check. (session.open_any is Task 5a's field.)
export async function addActivityFacts(
  items: Item[],
  checks: readonly CheckDef[],
  rt: ActivityRuntime,
  inScope: (item: Item) => boolean = () => true
): Promise<{ items: Item[]; warnings: string[] }> {
  if (!checks.some((c) => c.kind === 'worktree_idle')) {
    return { items, warnings: [] }
  }
  const paths = [
    ...new Set(
      items
        .filter(inScope)
        .map((i) => i.fields['worktree.path'])
        .filter((p): p is string => typeof p === 'string')
    )
  ]
  const warnings: string[] = []
  const busy = await busyFacts(rt, paths, warnings)
  return {
    items: items.map((item) => ({
      ...item,
      fields: { ...item.fields, ...activityFields(item, busy) }
    })),
    warnings
  }
}

export function runtimeActivity(
  runtime: BusyRuntime,
  terminalAlive: ActivityRuntime['terminalAlive'],
  store: PilotStore
): ActivityRuntime {
  return {
    terminals: () => listBusyTerminals(runtime),
    reads: () => runtimeBusyReads(runtime),
    endedRunTerminal: (terminals) => endedRunTerminals(store, terminals),
    terminalAlive
  }
}
