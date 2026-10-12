import type Database from '../../../../../main/sqlite/sync-database'
import type { DetailsRef, DetailsSnapshot } from '../../shared/details'

export function jsonOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value)
}

export function detailsRefOf(json: unknown): DetailsRef | null {
  return json === null || json === undefined ? null : (JSON.parse(String(json)) as DetailsRef)
}

// The card's digest and the snapshot of that same version, in one read (null: no such card).
export function readCurrentDetails(
  db: Database,
  id: string
): { digest: string; snapshot: DetailsSnapshot | null } | null {
  const row = db
    .prepare('SELECT digest, details_snapshot_json AS s FROM inbox_items WHERE id = ?')
    .get(id) as { digest: string; s: string | null } | undefined
  if (!row) {
    return null
  }
  return { digest: row.digest, snapshot: row.s ? (JSON.parse(row.s) as DetailsSnapshot) : null }
}

export function readSnapshot(db: Database, id: string): DetailsSnapshot | null {
  const row = db.prepare('SELECT details_snapshot_json AS s FROM inbox_items WHERE id = ?').get(id)
  const json = (row as { s: string | null } | undefined)?.s
  return json ? (JSON.parse(json) as DetailsSnapshot) : null
}

// Not a new version on its own: the caller edits the ref (and the digest) in the same transaction.
export function writeSnapshot(db: Database, id: string, snapshot: DetailsSnapshot | null): void {
  db.prepare('UPDATE inbox_items SET details_snapshot_json = ? WHERE id = ?').run(
    jsonOrNull(snapshot),
    id
  )
}
