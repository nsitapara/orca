import type Database from '../../../../../main/sqlite/sync-database'
import type { RunRow, TickRow } from '../../shared/api-types'
import { toRun } from './run-rows'

// A tick with nothing to do: it didn't fail, started no run, read or expired no handover, and was a re-check, or warned
// of nothing, wasn't triggered and found every item not due, out of scope or held. Activity can leave these out.
export const QUIET_TICK = `(ticks.status = 'ok'
  AND NOT EXISTS (SELECT 1 FROM runs WHERE runs.tick_id = ticks.id)
  AND NOT EXISTS (SELECT 1 FROM handovers WHERE handovers.tick_id = ticks.id)
  AND (ticks.recheck = 1 OR (ticks.warnings_json = '[]' AND ticks.trigger_json IS NULL
    AND NOT EXISTS (SELECT 1 FROM json_each(ticks.counts_json)
      WHERE json_each.key NOT IN ('notdue', 'out_of_scope', 'held') AND json_each.value > 0))))`

export function toTick(r: Record<string, unknown>): TickRow {
  return {
    id: Number(r.id),
    automationId: String(r.automation_id),
    startedAt: Number(r.started_at),
    finishedAt: (r.finished_at as number | null) ?? null,
    status: r.status as TickRow['status'],
    error: (r.error as string | null) ?? null,
    counts: JSON.parse(String(r.counts_json)),
    warnings: JSON.parse(String(r.warnings_json ?? '[]'))
  }
}

// ids null: every automation. The list is one JSON parameter, read with json_each.
const IN_IDS = '(? IS NULL OR automation_id IN (SELECT value FROM json_each(?)))'

function idsParams(ids: readonly string[] | null): [string | null, string | null] {
  const json = ids === null ? null : JSON.stringify(ids)
  return [json, json]
}

// Activity across automations and the run panel (spec §4): reads only.
export class ActivityStore {
  constructor(private readonly db: Database) {}

  // The ticks of these automations that started at or after `since`, newest first; `skipQuiet` leaves out QUIET_TICK.
  ticks(
    ids: readonly string[] | null,
    since: number,
    limit: number,
    skipQuiet: boolean
  ): TickRow[] {
    const quiet = skipQuiet ? `AND NOT ${QUIET_TICK}` : ''
    return this.db
      .prepare(
        `SELECT * FROM ticks WHERE ${IN_IDS} AND started_at >= ? ${quiet} ORDER BY started_at DESC, id DESC LIMIT ?`
      )
      .all(...idsParams(ids), since, limit)
      .map((r) => toTick(r as never))
  }

  // Runs still going or waiting on a person, however old: Running now, Waiting on you, the list's lit chips.
  live(ids: readonly string[] | null): RunRow[] {
    return this.db
      .prepare(
        `SELECT * FROM runs WHERE ${IN_IDS} AND status IN ('running', 'asking', 'needs_you') ORDER BY started_at DESC, id`
      )
      .all(...idsParams(ids))
      .map((r) => toRun(r as never))
  }

  // Runs no tick started (answer runs, imports), since `since`, newest first: Activity lists them on their own.
  unticked(ids: readonly string[] | null, since: number, limit: number): RunRow[] {
    return this.db
      .prepare(
        `SELECT * FROM runs WHERE ${IN_IDS} AND tick_id IS NULL AND started_at >= ? ORDER BY started_at DESC, id LIMIT ?`
      )
      .all(...idsParams(ids), since, limit)
      .map((r) => toRun(r as never))
  }

  // The answer runs of a run (parent_run_id), newest first.
  // "Hide automation runs": the tabs among `tabIds` a step ran in. A step's pane key is `<tabId>:<leafId>`.
  automationTabs(tabIds: readonly string[]): string[] {
    if (tabIds.length === 0) {
      return []
    }
    return this.db
      .prepare(
        `SELECT DISTINCT t.value AS tabId FROM json_each(?) AS t WHERE EXISTS (
           SELECT 1 FROM steps WHERE substr(pane_key, 1, length(t.value) + 1) = t.value || ':')`
      )
      .all(JSON.stringify(tabIds))
      .map((r) => String(r.tabId))
  }

  children(runId: string): RunRow[] {
    return this.db
      .prepare('SELECT * FROM runs WHERE parent_run_id = ? ORDER BY started_at DESC, id')
      .all(runId)
      .map((r) => toRun(r as never))
  }

  // The runs these automations started for one item key, newest first: job 15's merges of one kept branch.
  forItem(automationIds: readonly string[] | null, itemKey: string): RunRow[] {
    return this.db
      .prepare(
        `SELECT * FROM runs WHERE (? IS NULL OR automation_id IN (SELECT value FROM json_each(?)))
           AND item_key = ? ORDER BY started_at DESC, id`
      )
      .all(automationIds === null ? null : 1, JSON.stringify(automationIds ?? []), itemKey)
      .map((r) => toRun(r as never))
  }
}
