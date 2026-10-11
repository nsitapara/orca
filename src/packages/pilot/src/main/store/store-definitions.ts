import type Database from '../../../../../main/sqlite/sync-database'
import type { AutomationDefinition } from '../../shared/definition/types'

export type StoredDefinition = { id: string; file: string; yaml: string; loadedAt: number }
export type StoredDefinitionError = { id: string; file: string; errors: string[]; at: number }

// Each automation's last valid version (contract §9), so an invalid edit doesn't stop it. The
// loader re-parses `yaml` before using it; parsed_json is kept for people reading the database,
// never trusted across an upgrade that changed the normalized definition.
export class DefinitionStore {
  constructor(private readonly db: Database) {}

  // loaded_at says since when this version has run, so it moves only when the file or its text does.
  saveValid(def: AutomationDefinition, yaml: string, at: number): void {
    this.db
      .prepare(
        `INSERT INTO definitions (id, file, yaml, parsed_json, loaded_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           loaded_at = CASE WHEN definitions.yaml = excluded.yaml AND definitions.file = excluded.file
             THEN definitions.loaded_at ELSE excluded.loaded_at END,
           file = excluded.file, yaml = excluded.yaml, parsed_json = excluded.parsed_json`
      )
      .run(def.id, def.file, yaml, JSON.stringify(def), at)
    this.db.prepare('DELETE FROM definition_errors WHERE id = ?').run(def.id)
  }

  lastValid(id: string): StoredDefinition | null {
    const r = this.db
      .prepare('SELECT id, file, yaml, loaded_at FROM definitions WHERE id = ?')
      .get(id)
    if (!r) {
      return null
    }
    return {
      id: String(r.id),
      file: String(r.file),
      yaml: String(r.yaml),
      loadedAt: Number(r.loaded_at)
    }
  }

  saveErrors(id: string, file: string, errors: string[], at: number): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO definition_errors (id, file, errors_json, at) VALUES (?, ?, ?, ?)'
      )
      .run(id, file, JSON.stringify(errors), at)
  }

  errors(): StoredDefinitionError[] {
    return this.db
      .prepare('SELECT id, file, errors_json, at FROM definition_errors ORDER BY id')
      .all()
      .map((r) => ({
        id: String(r.id),
        file: String(r.file),
        errors: JSON.parse(String(r.errors_json)) as string[],
        at: Number(r.at)
      }))
  }

  // A removed file must not come back later as somebody's "last valid version".
  forgetAllBut(ids: string[]): void {
    const keep = JSON.stringify(ids)
    this.db
      .prepare('DELETE FROM definitions WHERE id NOT IN (SELECT value FROM json_each(?))')
      .run(keep)
    this.db
      .prepare('DELETE FROM definition_errors WHERE id NOT IN (SELECT value FROM json_each(?))')
      .run(keep)
  }
}
