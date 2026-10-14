import type { HandoverRow } from '../../shared/api-types'
import { fedIdProblem } from '../../shared/definition/item-ids'
import type { AutomationDefinition } from '../../shared/definition/types'
import { idsFromSchema } from '../../shared/definition/where'
import { MAX_IDS, readIdsFrom, runIdsCommand } from '../sources/ids-from'
import type { RepoFacts } from '../sources/types'
import type { DecideDeps } from './tick-decide'

// The handover rows a tick read (where.ids_from: { feed: true }), the ones it drops (with why) and the ids its
// source had no item for: the runner settles them (main/handover/tick-handover.ts).
export type FedOutcome = {
  fed: HandoverRow[]
  dropped: { row: HandoverRow; reason: string }[]
  missing: string[]
  skipped: string[]
}
export type TickIds = {
  ids: string[]
  fed: HandoverRow[]
  dropped: FedOutcome['dropped']
  warnings: string[]
}

// The fed ids first (oldest first), then the command's, each once whatever its case (a Linear id reads the same either
// way, and one item twice would break the tick). Past MAX_IDS the rest wait: a fed id never falls off, since the feed
// is read at most MAX_IDS rows at a time and comes first.
function mergeIds(
  fed: HandoverRow[],
  listed: readonly string[],
  dropped: FedOutcome['dropped']
): TickIds {
  const ids = new Map<string, string>()
  for (const id of [...fed.map((h) => h.itemId), ...listed]) {
    const key = id.toLowerCase()
    if (!ids.has(key)) {
      ids.set(key, id)
    }
  }
  const all = [...ids.values()]
  if (all.length <= MAX_IDS) {
    return { ids: all, fed, dropped, warnings: [] }
  }
  const late = `ids_from: ${all.length - MAX_IDS} id(s) past the ${MAX_IDS}-id limit wait for a later tick`
  return { ids: all.slice(0, MAX_IDS), fed, dropped, warnings: [late] }
}

// where.ids_from, when the automation has one: the ids its source reads instead of listing. `feed: true` reads the
// receiver's pending handovers; `run` runs its command, whose failure throws, so the tick is recorded failed with the
// reason and its fed ids stay pending. With both, the fed ids are intersected with the command's list.
export async function idsForTick(
  def: AutomationDefinition,
  repo: RepoFacts,
  deps: DecideDeps
): Promise<TickIds | null> {
  const raw = def.items?.where.ids_from
  if (raw === undefined) {
    return null
  }
  const spec = idsFromSchema.parse(raw)
  const pending = spec.feed ? deps.store.handovers.fresh(def.id, MAX_IDS, deps.now()) : []
  // A fed id the source couldn't read (WEB-123 for Linear) is dropped here, so it never fails the tick.
  const kind = def.items?.kind ?? null
  const dropped = pending.flatMap((row) => {
    const problem = fedIdProblem(kind, row.itemId)
    return problem ? [{ row, reason: `dropped: ${problem}` }] : []
  })
  const fed = pending.filter((row) => !dropped.some((d) => d.row.id === row.id))
  if (spec.run === undefined) {
    return mergeIds(fed, [], dropped)
  }
  const opts = {
    automationId: def.id,
    file: def.file,
    repoPath: repo.path,
    engineEnv: deps.fields.engineEnv
  }
  const listed = await readIdsFrom({ ...spec, run: spec.run }, opts, deps.runIds ?? runIdsCommand)
  // With its own command, a feed speeds a stage up but never adds an item: a fed id it doesn't list (yet: the list can
  // lag) isn't read, and waits pending until it is listed or expires.
  const own = new Set(listed.map((id) => id.toLowerCase()))
  const kept = fed.filter((row) => own.has(row.itemId.toLowerCase()))
  const waiting = fed
    .filter((row) => !own.has(row.itemId.toLowerCase()))
    .map(
      (row) =>
        `${row.itemId} was handed over but isn't in the stage's own list yet; it waits (at most 7 days)`
    )
  const merged = mergeIds(kept, listed, dropped)
  return { ...merged, warnings: [...waiting, ...merged.warnings] }
}
