import type { ItemDecision } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import { oncePerKey } from '../../shared/template'
import type { Item } from '../sources/types'
import type { PilotStore } from '../store/store'

export const WAITS_FOR_TICK = "Waits for its job's next tick"

// A re-check or Retry tick decides only its job's line and Retry's keys, so it never paces the job's other due items.
// A per-tick overflow waits for the job's own tick, as per_tick intends. Undefined: the tick decides every item.
export function lineKeysOf(
  store: PilotStore,
  def: AutomationDefinition,
  opts: { recheck?: boolean; byHandKeys?: ReadonlySet<string> }
): ReadonlySet<string> | undefined {
  if (opts.recheck !== true && opts.byHandKeys === undefined) {
    return undefined
  }
  const line = store.capacity
    .queued()
    .filter((q) => q.automationId === def.id && q.holdCode !== 'tick_limit')
    .map((q) => q.itemKey)
  return new Set([...line, ...(opts.byHandKeys ?? [])])
}

// The items a line-scoped tick decides (by item key, or the once key their listed fields name), and a not-due
// decision for each other item: no facts are read for it, and it isn't stored.
export function splitByLine(
  def: AutomationDefinition,
  items: readonly Item[],
  lineKeys: ReadonlySet<string> | undefined
): { inLine: Item[]; waits: ItemDecision[] } {
  if (lineKeys === undefined) {
    return { inLine: [...items], waits: [] }
  }
  const inLine: Item[] = []
  const waits: ItemDecision[] = []
  for (const item of items) {
    const onceKey = oncePerKey(def.oncePer, item.fields, item.key)
    if (lineKeys.has(item.key) || lineKeys.has(onceKey)) {
      inLine.push(item)
      continue
    }
    waits.push({
      key: item.key,
      label: item.label,
      onceKey,
      fields: item.fields,
      checks: [],
      verdict: 'notdue',
      reason: WAITS_FOR_TICK
    })
  }
  return { inLine, waits }
}
