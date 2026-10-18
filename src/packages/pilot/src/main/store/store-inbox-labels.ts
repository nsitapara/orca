import type Database from '../../../../../main/sqlite/sync-database'
import type { DetailsRef, DetailsSnapshot } from '../../shared/details'
import { subjectOf, summaryOf } from '../../shared/details-summary'

// Refs stored before `summary` and `subject` existed get them from their snapshot, once. Only the ref column
// changes: the digest, version and updated_at stay as they were (neither is part of the digest).
export function fillSummaries(db: Database): void {
  const rows = db
    .prepare(
      `SELECT id, details_ref_json AS r, details_snapshot_json AS s FROM inbox_items
        WHERE details_ref_json IS NOT NULL AND details_snapshot_json IS NOT NULL
          AND (json_extract(details_ref_json, '$.summary') IS NULL
            OR json_extract(details_ref_json, '$.subject') IS NULL)`
    )
    .all() as { id: string; r: string; s: string }[]
  for (const row of rows) {
    // One unreadable row must not fail the whole list: it stays as it was.
    try {
      const ref = JSON.parse(row.r) as DetailsRef
      const snap = JSON.parse(row.s) as DetailsSnapshot
      const summary = summaryOf(snap.bundle, ref.drafted)
      db.prepare('UPDATE inbox_items SET details_ref_json = ? WHERE id = ?').run(
        JSON.stringify({ ...ref, summary, subject: subjectOf(snap.bundle) ?? '' }),
        row.id
      )
    } catch {
      continue
    }
  }
}

// What each card is about, for its group's name: the label of its own run, else of the newest tick that
// listed its item. One query for each, whatever the number of cards. Cards with neither are left out.
export function itemLabels(
  db: Database,
  cards: { id: string; runId: string | null; automationId: string; itemKey: string | null }[]
): Map<string, string> {
  const runIds = [...new Set(cards.flatMap((c) => (c.runId ? [c.runId] : [])))]
  const runLabels = new Map<string, string>()
  if (runIds.length > 0) {
    const rows = db
      .prepare('SELECT id, item_label AS l FROM runs WHERE id IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(runIds)) as { id: string; l: string }[]
    for (const r of rows) {
      runLabels.set(r.id, r.l)
    }
  }
  const keys = [...new Set(cards.flatMap((c) => (c.itemKey ? [c.itemKey] : [])))]
  const tickLabels = new Map<string, string>()
  if (keys.length > 0) {
    const rows = db
      .prepare(
        `SELECT t.automation_id AS a, ti.item_key AS k, ti.label AS l, MAX(ti.tick_id)
           FROM tick_items ti JOIN ticks t ON t.id = ti.tick_id
          WHERE ti.item_key IN (SELECT value FROM json_each(?))
          GROUP BY t.automation_id, ti.item_key`
      )
      .all(JSON.stringify(keys)) as { a: string; k: string; l: string }[]
    for (const r of rows) {
      tickLabels.set(`${r.a}\0${r.k}`, r.l)
    }
  }
  const labels = new Map<string, string>()
  for (const c of cards) {
    const own = c.runId ? runLabels.get(c.runId) : undefined
    const ticked = c.itemKey ? tickLabels.get(`${c.automationId}\0${c.itemKey}`) : undefined
    const label = own?.trim() || ticked?.trim()
    if (label) {
      labels.set(c.id, label)
    }
  }
  return labels
}
