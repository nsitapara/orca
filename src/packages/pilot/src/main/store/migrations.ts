import type Database from '../../../../../main/sqlite/sync-database'

export const PILOT_SCHEMA_VERSION = 4

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

// Contract §9: multi-step runs, shell steps and outputs, the inbox and its answer queue, actions,
// events, each automation's last valid definition, the field cache and per-worktree agent sessions.
const V2 = `
ALTER TABLE tick_items ADD COLUMN worktree_path TEXT;
CREATE INDEX tick_items_worktree ON tick_items(worktree_path);
ALTER TABLE runs ADD COLUMN worktree_id TEXT;
ALTER TABLE runs ADD COLUMN trigger TEXT NOT NULL DEFAULT 'schedule';
ALTER TABLE runs ADD COLUMN parent_run_id TEXT;
ALTER TABLE runs ADD COLUMN imported INTEGER NOT NULL DEFAULT 0;
ALTER TABLE steps ADD COLUMN kind TEXT NOT NULL DEFAULT 'agent';
ALTER TABLE steps ADD COLUMN mode TEXT;
ALTER TABLE steps ADD COLUMN model TEXT;
ALTER TABLE steps ADD COLUMN outputs_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE steps ADD COLUMN when_expr TEXT;
ALTER TABLE steps ADD COLUMN exit_code INTEGER;
ALTER TABLE steps ADD COLUMN output_tail TEXT;
ALTER TABLE steps ADD COLUMN session_pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE handled ADD COLUMN status TEXT NOT NULL DEFAULT 'started';
ALTER TABLE handled ADD COLUMN failed_at INTEGER;
CREATE TABLE definitions (id TEXT PRIMARY KEY, file TEXT NOT NULL, yaml TEXT NOT NULL, parsed_json TEXT NOT NULL, loaded_at INTEGER NOT NULL);
CREATE TABLE definition_errors (id TEXT PRIMARY KEY, file TEXT NOT NULL, errors_json TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE field_cache (automation_id TEXT NOT NULL, field TEXT NOT NULL, item_key TEXT NOT NULL, cache_key TEXT NOT NULL,
  value_json TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (automation_id, field, item_key));
CREATE TABLE agent_sessions (automation_id TEXT NOT NULL, worktree_path TEXT NOT NULL, agent TEXT NOT NULL,
  session_id TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (automation_id, worktree_path, agent));
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, automation_id TEXT, run_id TEXT,
  worktree_path TEXT, item_key TEXT, kind TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}');
CREATE INDEX events_worktree ON events(worktree_path, at DESC);
CREATE INDEX events_run ON events(run_id);
CREATE TABLE inbox_items (id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, run_id TEXT, step_idx INTEGER, item_key TEXT,
  worktree_path TEXT, person TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, context TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '[]', suggested TEXT, details_md TEXT, action TEXT, action_args_json TEXT,
  digest TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open', -- open|answered|done|obsolete|stale|dismissed
  answer_json TEXT, answered_at INTEGER, answered_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  outcome TEXT, replies_json TEXT NOT NULL DEFAULT '[]', parts_json TEXT NOT NULL DEFAULT '{}',
  switch_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'engine', vault_ref TEXT);
CREATE INDEX inbox_open ON inbox_items(status, person);
CREATE INDEX inbox_worktree ON inbox_items(worktree_path, status);
CREATE TABLE queue (id INTEGER PRIMARY KEY AUTOINCREMENT,
  inbox_item_id TEXT NOT NULL REFERENCES inbox_items(id) ON DELETE CASCADE,
  state TEXT NOT NULL, -- not_ready|ready|held|dispatched|failed
  hold_reason TEXT, ready_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, route TEXT, target_session_id TEXT,
  dispatched_run_id TEXT, updated_at INTEGER NOT NULL);
CREATE TABLE action_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, inbox_item_id TEXT, run_id TEXT, action TEXT NOT NULL,
  args_json TEXT NOT NULL, digest TEXT NOT NULL, phase TEXT NOT NULL,
  status TEXT NOT NULL, -- running|done|failed|stale|needs_agent|not_yet|refused
  output TEXT,
  dry_run INTEGER NOT NULL DEFAULT 0, started_at INTEGER NOT NULL, finished_at INTEGER);
CREATE TABLE claims (worktree_path TEXT PRIMARY KEY, holder TEXT NOT NULL, until INTEGER NOT NULL);
`

// Task 8d: the args an agent step's process was launched with (or, for a step sent into a running
// process, that process's), written by the launcher only. NULL: not known (older rows, shell steps).
const V3 = `
ALTER TABLE steps ADD COLUMN launch_args_json TEXT;
`

// Task 28b: each step's token usage, read once when it ends, by local day and model (usage.py's buckets).
const V4 = `
ALTER TABLE steps ADD COLUMN usage_measured_at INTEGER;
CREATE TABLE step_usage (run_id TEXT NOT NULL, idx INTEGER NOT NULL, day TEXT NOT NULL, model TEXT NOT NULL,
  requests INTEGER NOT NULL, input INTEGER NOT NULL, cache_read INTEGER NOT NULL, cache_write INTEGER NOT NULL,
  output INTEGER NOT NULL, cost_usd REAL, PRIMARY KEY (run_id, idx, day, model),
  FOREIGN KEY (run_id, idx) REFERENCES steps(run_id, idx) ON DELETE CASCADE);
CREATE INDEX step_usage_by_day ON step_usage (day);
`

// MIGRATIONS[n - 1] takes a database from version n - 1 to n.
const MIGRATIONS: readonly string[] = [V1, V2, V3, V4]

// Same pattern as Orca's orchestration.db (migrate.ts): user_version + one transaction, all or nothing.
// `target` lets tests build a database at an older version.
export function migrate(db: Database, target = PILOT_SCHEMA_VERSION): void {
  if ((db.pragma('user_version', { simple: true }) as number) >= target) {
    return
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    // Read again under the write lock: another process (desktop and orcad share the file) may have
    // migrated between the look above and the lock.
    const current = db.pragma('user_version', { simple: true }) as number
    for (let version = current + 1; version <= target; version++) {
      db.exec(MIGRATIONS[version - 1])
    }
    // Never lowers the version a newer process wrote.
    if (current < target) {
      db.pragma(`user_version = ${target}`)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
