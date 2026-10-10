import type Database from '../../../../../main/sqlite/sync-database'

export const PILOT_SCHEMA_VERSION = 1

const V1 = `
CREATE TABLE ticks (id INTEGER PRIMARY KEY AUTOINCREMENT, automation_id TEXT NOT NULL, started_at INTEGER NOT NULL,
  finished_at INTEGER, dry_run INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, error TEXT, counts_json TEXT NOT NULL DEFAULT '{}');
CREATE INDEX ticks_by_automation ON ticks (automation_id, started_at DESC);
CREATE TABLE tick_items (tick_id INTEGER NOT NULL REFERENCES ticks(id) ON DELETE CASCADE, item_key TEXT NOT NULL,
  label TEXT NOT NULL, verdict TEXT NOT NULL, reason TEXT NOT NULL, checks_json TEXT NOT NULL, fields_json TEXT NOT NULL,
  run_id TEXT, PRIMARY KEY (tick_id, item_key));
CREATE TABLE handled (automation_id TEXT NOT NULL, once_key TEXT NOT NULL, run_id TEXT, at INTEGER NOT NULL,
  PRIMARY KEY (automation_id, once_key));
CREATE TABLE seen (automation_id TEXT NOT NULL, item_key TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (automation_id, item_key));
CREATE TABLE runs (id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, tick_id INTEGER, item_key TEXT NOT NULL,
  item_label TEXT NOT NULL, worktree_path TEXT, status TEXT NOT NULL, outcome TEXT, started_at INTEGER NOT NULL,
  finished_at INTEGER, cost_usd REAL, tokens INTEGER);
CREATE INDEX runs_by_tick ON runs (tick_id);
CREATE INDEX runs_by_automation_status ON runs (automation_id, status);
CREATE INDEX runs_by_worktree ON runs (worktree_path);
CREATE TABLE steps (run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, idx INTEGER NOT NULL, name TEXT NOT NULL,
  agent TEXT NOT NULL, skill TEXT, status TEXT NOT NULL, terminal_handle TEXT, pane_key TEXT, session_id TEXT,
  transcript_path TEXT, cost_usd REAL, tokens INTEGER, started_at INTEGER, finished_at INTEGER, error TEXT,
  PRIMARY KEY (run_id, idx));
CREATE INDEX steps_by_status ON steps (status);
`

// Same pattern as Orca's orchestration.db (migrate.ts): user_version + one transaction, all or nothing.
export function migrate(db: Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current >= PILOT_SCHEMA_VERSION) {
    return
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    if (current < 1) {
      db.exec(V1)
    }
    db.pragma(`user_version = ${PILOT_SCHEMA_VERSION}`)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
