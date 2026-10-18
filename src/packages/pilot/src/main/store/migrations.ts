import type Database from '../../../../../main/sqlite/sync-database'

export const PILOT_SCHEMA_VERSION = 17

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

// Card Details parity: a card's Details bundle, as the light ref the list carries and the snapshot read by id.
const V5 = `
ALTER TABLE inbox_items ADD COLUMN details_ref_json TEXT;
ALTER TABLE inbox_items ADD COLUMN details_snapshot_json TEXT;
`

const V6 = `ALTER TABLE inbox_items ADD COLUMN preparation_json TEXT;`

// A "Not prepared" notice's preparation key (D2), so the prepared card retires it.
const V7 = `ALTER TABLE inbox_items ADD COLUMN not_prepared_key TEXT;`

// A tick's warnings (an id its source couldn't read, a capped listing), so Activity shows them.
const V8 = `ALTER TABLE ticks ADD COLUMN warnings_json TEXT NOT NULL DEFAULT '[]';`

// Multi-stage jobs: the ids a stage's run hands the next stage (job.feeds … pass), pending until a tick of that
// stage reads them, once per (sender run, receiver, id); and what triggered a tick (a feed's run: now).
const V9 = `
CREATE TABLE handovers (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id TEXT NOT NULL, sender_run_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL, item_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending', -- pending|consumed|expired
  consumed_at INTEGER, tick_id INTEGER, verdict TEXT, reason TEXT, run_id TEXT,
  UNIQUE (sender_run_id, receiver_id, item_id));
CREATE INDEX handovers_pending ON handovers (receiver_id, state, id);
CREATE INDEX handovers_sender ON handovers (sender_id, receiver_id, id);
CREATE INDEX handovers_tick ON handovers (tick_id);
ALTER TABLE ticks ADD COLUMN trigger_json TEXT;
`

// Job environments (pilotcli env, workspace: { env }). home_path is the item's worktree: cards, answers, the timeline and the
// worktree panel read it. worktree_path stays where the run works (its cwd and its claim). env_path is the folder pilotcli
// made, normalized (worktreePathKey). env_json holds the create command, who prepares it and pilotcli's result.
// env_removed_at is set once env delete succeeded, or when nothing was made.
const V10 = `
ALTER TABLE runs ADD COLUMN home_path TEXT;
ALTER TABLE runs ADD COLUMN env_state TEXT;
ALTER TABLE runs ADD COLUMN env_mode TEXT;
ALTER TABLE runs ADD COLUMN env_reason TEXT;
ALTER TABLE runs ADD COLUMN env_path TEXT;
ALTER TABLE runs ADD COLUMN env_json TEXT;
ALTER TABLE runs ADD COLUMN env_removed_at INTEGER;
ALTER TABLE runs ADD COLUMN env_delete_error TEXT;
ALTER TABLE runs ADD COLUMN env_delete_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN env_retry_at INTEGER;
-- hold_home (Task 11): the step whose claim on home_path this run holds; it counts only while that step runs.
ALTER TABLE runs ADD COLUMN home_hold_step INTEGER;
CREATE INDEX runs_env_open ON runs (env_state) WHERE env_state IS NOT NULL AND env_removed_at IS NULL;
CREATE INDEX runs_by_home ON runs (home_path);
`

// A dry run is stored nowhere (it returns its decisions): the dry-run ticks stored before go, with their items, and so
// does the column that told them apart.
const V11 = `
DELETE FROM tick_items WHERE tick_id IN (SELECT id FROM ticks WHERE dry_run = 1);
DELETE FROM ticks WHERE dry_run = 1;
ALTER TABLE ticks DROP COLUMN dry_run;
`

// A shell step's pilotcli result (shared/run/step-result.ts): the envelope its whole stdout was, as JSON, or NULL.
const V12 = `ALTER TABLE steps ADD COLUMN result_json TEXT;`

// Run visibility (Done for you): when Nish acknowledged a finished run. Runs that ended before it count as
// acknowledged, except those with an open default he never saw; runs held at needs_you only by defaults are done.
const V13 = `
ALTER TABLE runs ADD COLUMN acknowledged_at INTEGER;
UPDATE runs SET status = 'done',
  outcome = CASE WHEN outcome LIKE 'Inbox: %' THEN 'Done' ELSE outcome END
  WHERE status = 'needs_you' AND NOT EXISTS (
    SELECT 1 FROM inbox_items i WHERE i.run_id = runs.id AND i.status = 'open' AND i.type != 'default');
UPDATE runs SET acknowledged_at = COALESCE(finished_at, started_at)
  WHERE status NOT IN ('asking', 'running') AND NOT EXISTS (
    SELECT 1 FROM inbox_items i WHERE i.run_id = runs.id AND i.status = 'open' AND i.type = 'default');
-- Done for you's poll (VisibilityStore.unacknowledged) reads only the runs nobody acknowledged, newest first.
CREATE INDEX runs_unacknowledged ON runs (COALESCE(finished_at, started_at)) WHERE acknowledged_at IS NULL;
`

// Run capacity: Pilot's settings (the run limit), the items waiting for a slot, and the most memory each run's
// processes held.
const V14 = `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE run_queue (automation_id TEXT NOT NULL, item_key TEXT NOT NULL, item_label TEXT NOT NULL,
  queued_at INTEGER NOT NULL, by_hand INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (automation_id, item_key));
ALTER TABLE runs ADD COLUMN peak_rss_bytes INTEGER;
`

// The Running page's Finished list: when a run joined the line for a slot (null: it never waited), and an index for
// the newest ended runs.
const V15 = `
ALTER TABLE runs ADD COLUMN queued_at INTEGER;
CREATE INDEX runs_finished ON runs (finished_at) WHERE finished_at IS NOT NULL;
`

// How long a run sat ended before Continue run reopened it: its time worked leaves those spans out.
const V16 = `
ALTER TABLE runs ADD COLUMN idle_ms INTEGER NOT NULL DEFAULT 0;
`

// Additive only: an older process still opens this database and ignores the new columns.
const V17 = `
ALTER TABLE run_queue ADD COLUMN due_at INTEGER;
ALTER TABLE run_queue ADD COLUMN hold_code TEXT;
ALTER TABLE run_queue ADD COLUMN hold_detail TEXT;
ALTER TABLE run_queue ADD COLUMN checked_at INTEGER;
UPDATE run_queue SET due_at = queued_at, hold_code = 'capacity', hold_detail = 'Waiting for a slot', checked_at = queued_at;
ALTER TABLE ticks ADD COLUMN recheck INTEGER NOT NULL DEFAULT 0;
ALTER TABLE handled ADD COLUMN failures INTEGER NOT NULL DEFAULT 0;
`

// MIGRATIONS[n - 1] takes a database from version n - 1 to n.
const MIGRATIONS: readonly string[] = [
  V1,
  V2,
  V3,
  V4,
  V5,
  V6,
  V7,
  V8,
  V9,
  V10,
  V11,
  V12,
  V13,
  V14,
  V15,
  V16,
  V17
]

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
