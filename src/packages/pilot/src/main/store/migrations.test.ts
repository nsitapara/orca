import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import Database from '../../../../../main/sqlite/sync-database'
import { migrate, PILOT_SCHEMA_VERSION } from './migrations'

function openDb(): Database {
  return new Database(join(mkdtempSync(join(tmpdir(), 'pilot-migrate-')), 'db.sqlite'))
}

function columnsOf(db: Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name)
}

function firstRow(db: Database, sql: string): Record<string, unknown> {
  return { ...db.prepare(sql).get() }
}

describe('migrate', () => {
  // Desktop and orcad open the same file: one may read the version, then wait on the lock while the other
  // migrates. Inside the transaction the version is read again, so nothing runs twice.
  it('re-reads the version inside its transaction, so a migration another process just ran is not run again', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pilot-migrate-')), 'db.sqlite')
    const early = new Database(path)
    migrate(early, PILOT_SCHEMA_VERSION - 1)
    const late = new Database(path)
    const pragma = late.pragma.bind(late)
    let reads = 0
    // The late process's first look predates the early process's migration below.
    late.pragma = ((sql: string, opts?: unknown) => {
      if (sql === 'user_version' && reads++ === 0) {
        migrate(early)
        return PILOT_SCHEMA_VERSION - 1
      }
      return pragma(sql, opts as never)
    }) as typeof late.pragma
    expect(() => migrate(late)).not.toThrow()
    expect(pragma('user_version', { simple: true })).toBe(PILOT_SCHEMA_VERSION)
  })

  it('never lowers a version another process raised past its own target meanwhile', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pilot-migrate-')), 'db.sqlite')
    const db = new Database(path)
    migrate(db, PILOT_SCHEMA_VERSION - 1)
    const pragma = db.pragma.bind(db)
    let reads = 0
    db.pragma = ((sql: string, opts?: unknown) => {
      if (sql === 'user_version' && reads++ === 0) {
        new Database(path).pragma(`user_version = ${PILOT_SCHEMA_VERSION + 1}`)
        return PILOT_SCHEMA_VERSION - 1
      }
      return pragma(sql, opts as never)
    }) as typeof db.pragma
    migrate(db)
    expect(pragma('user_version', { simple: true })).toBe(PILOT_SCHEMA_VERSION + 1)
  })

  it('creates every v2 table in a new database', () => {
    const db = openDb()
    migrate(db)
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all()
      .map((r) => String(r.name))
    expect(tables).toEqual([
      'action_runs',
      'agent_sessions',
      'claims',
      'definition_errors',
      'definitions',
      'events',
      'field_cache',
      'handled',
      'handovers',
      'inbox_items',
      'queue',
      'run_queue',
      'runs',
      'seen',
      'settings',
      'step_usage',
      'steps',
      'tick_items',
      'ticks'
    ])
    expect(db.pragma('user_version', { simple: true })).toBe(PILOT_SCHEMA_VERSION)
    expect(columnsOf(db, 'inbox_items')).toEqual(
      expect.arrayContaining([
        'outcome',
        'replies_json',
        'parts_json',
        'switch_json',
        'source',
        'vault_ref'
      ])
    )
    expect(columnsOf(db, 'field_cache')).toEqual(
      expect.arrayContaining([
        'automation_id',
        'field',
        'item_key',
        'cache_key',
        'value_json',
        'at'
      ])
    )
  })

  it('keys field_cache by (automation, field, item): a second cache key for an item replaces the first', () => {
    const db = openDb()
    migrate(db)
    const put = db.prepare(
      'INSERT OR REPLACE INTO field_cache (automation_id, field, item_key, cache_key, value_json, at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    put.run('a', 'f', 'mr:1', 'pass-1', '"x"', 1)
    put.run('a', 'f', 'mr:1', 'pass-2', '"y"', 2)
    expect(
      db
        .prepare('SELECT cache_key, value_json FROM field_cache')
        .all()
        .map((r) => ({ ...r }))
    ).toEqual([{ cache_key: 'pass-2', value_json: '"y"' }])
  })

  it('defaults the E2 inbox columns on a new card', () => {
    const db = openDb()
    migrate(db)
    db.exec(
      "INSERT INTO inbox_items (id, automation_id, person, type, title, digest, created_at, updated_at) VALUES ('i1', 'a', 'p', 'question', 't', 'd', 1, 1)"
    )
    expect(
      firstRow(db, 'SELECT outcome, replies_json, parts_json, switch_json, source FROM inbox_items')
    ).toEqual({
      outcome: null,
      replies_json: '[]',
      parts_json: '{}',
      switch_json: '[]',
      source: 'engine'
    })
  })

  it('moves a v1 database to v2, keeping its rows and defaulting the new columns', () => {
    const db = openDb()
    migrate(db, 1)
    db.exec(`
      INSERT INTO runs (id, automation_id, tick_id, item_key, item_label, worktree_path, status, started_at)
        VALUES ('r1', 'a', NULL, '!1', '!1 x', '/wt', 'done', 1);
      INSERT INTO steps (run_id, idx, name, agent, skill, status) VALUES ('r1', 0, 'step1', 'claude', NULL, 'done');
      INSERT INTO handled (automation_id, once_key, run_id, at) VALUES ('a', '1:2', 'r1', 1);
    `)
    migrate(db)
    expect(
      firstRow(db, 'SELECT id, worktree_id, trigger, parent_run_id, imported FROM runs')
    ).toEqual({
      id: 'r1',
      worktree_id: null,
      trigger: 'schedule',
      parent_run_id: null,
      imported: 0
    })
    expect(
      firstRow(
        db,
        'SELECT kind, mode, model, outputs_json, when_expr, exit_code, output_tail, session_pinned FROM steps'
      )
    ).toEqual({
      kind: 'agent',
      mode: null,
      model: null,
      outputs_json: '{}',
      when_expr: null,
      exit_code: null,
      output_tail: null,
      session_pinned: 0
    })
    expect(firstRow(db, 'SELECT once_key, status, failed_at FROM handled')).toEqual({
      once_key: '1:2',
      status: 'started',
      failed_at: null
    })
    expect(columnsOf(db, 'tick_items')).toContain('worktree_path')
  })

  it('leaves a v1 database untouched when v2 fails part way (all or nothing)', () => {
    const db = openDb()
    migrate(db, 1)
    db.exec('CREATE TABLE definitions (id TEXT)')
    expect(() => migrate(db)).toThrow(/definitions/)
    expect(db.pragma('user_version', { simple: true })).toBe(1)
    expect(columnsOf(db, 'runs')).not.toContain('trigger')
  })

  it('moves a v2 database to v3: steps gain launch_args_json, unknown (NULL) on existing rows', () => {
    const db = openDb()
    migrate(db, 2)
    db.exec(
      "INSERT INTO runs (id, automation_id, item_key, item_label, status, started_at) VALUES ('r1', 'a', 'k', 'l', 'done', 1)"
    )
    db.exec(
      "INSERT INTO steps (run_id, idx, name, agent, status) VALUES ('r1', 0, 'fix', 'claude', 'done')"
    )
    migrate(db, 3)
    expect(db.pragma('user_version', { simple: true })).toBe(3)
    expect(firstRow(db, 'SELECT launch_args_json FROM steps')).toEqual({ launch_args_json: null })
  })

  it('moves a v3 database to v4, keeping its steps and adding the usage table', () => {
    const db = openDb()
    migrate(db, 3)
    db.exec(
      "INSERT INTO runs (id, automation_id, item_key, item_label, status, started_at) VALUES ('r1', 'a', 'k', 'l', 'done', 1)"
    )
    db.exec(
      "INSERT INTO steps (run_id, idx, name, agent, status) VALUES ('r1', 0, 'fix', 'claude', 'done')"
    )
    migrate(db, 4)
    expect(firstRow(db, 'SELECT run_id, usage_measured_at FROM steps')).toEqual({
      run_id: 'r1',
      usage_measured_at: null
    })
    expect(columnsOf(db, 'step_usage')).toEqual([
      'run_id',
      'idx',
      'day',
      'model',
      'requests',
      'input',
      'cache_read',
      'cache_write',
      'output',
      'cost_usd'
    ])
    expect(db.pragma('user_version', { simple: true })).toBe(4)
  })

  it('moves a v4 database to the current schema: a card gains its Details, preparation and notice columns, all empty', () => {
    const db = openDb()
    migrate(db, 4)
    db.exec(
      "INSERT INTO inbox_items (id, automation_id, person, type, title, digest, created_at, updated_at) VALUES ('i1', 'a', 'p', 'question', 't', 'd', 1, 1)"
    )
    migrate(db)
    expect(PILOT_SCHEMA_VERSION).toBe(15)
    expect(db.pragma('user_version', { simple: true })).toBe(15)
    expect(
      firstRow(
        db,
        'SELECT id, details_ref_json, details_snapshot_json, preparation_json, not_prepared_key FROM inbox_items'
      )
    ).toEqual({
      id: 'i1',
      details_ref_json: null,
      details_snapshot_json: null,
      preparation_json: null,
      not_prepared_key: null
    })
  })

  it('moves a v7 database on: each tick gains its warnings, none for the ticks it already has', () => {
    const db = openDb()
    migrate(db, 7)
    db.exec(
      "INSERT INTO ticks (automation_id, started_at, status) VALUES ('dev-e2e-fix-start', 1, 'ok')"
    )
    migrate(db)
    expect(firstRow(db, 'SELECT automation_id, warnings_json FROM ticks')).toEqual({
      automation_id: 'dev-e2e-fix-start',
      warnings_json: '[]'
    })
  })

  it('moves a v8 database to v9: a handovers table, and each tick gains its trigger, none on the ticks it has', () => {
    const db = openDb()
    migrate(db, 8)
    db.exec(
      "INSERT INTO ticks (automation_id, started_at, status) VALUES ('dev-e2e-fix-start', 1, 'ok')"
    )
    migrate(db)
    expect(firstRow(db, 'SELECT automation_id, trigger_json FROM ticks')).toEqual({
      automation_id: 'dev-e2e-fix-start',
      trigger_json: null
    })
    expect(columnsOf(db, 'handovers')).toEqual([
      'id',
      'sender_id',
      'sender_run_id',
      'receiver_id',
      'item_id',
      'created_at',
      'state',
      'consumed_at',
      'tick_id',
      'verdict',
      'reason',
      'run_id'
    ])
  })

  it('keeps one handover per (sender run, receiver, id)', () => {
    const db = openDb()
    migrate(db)
    const put = db.prepare(
      'INSERT OR IGNORE INTO handovers (sender_id, sender_run_id, receiver_id, item_id, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    put.run('a', 'run-1', 'b', 'WEB-1', 1)
    put.run('a', 'run-1', 'b', 'WEB-1', 2)
    put.run('a', 'run-2', 'b', 'WEB-1', 3)
    expect(
      db
        .prepare('SELECT sender_run_id, state FROM handovers ORDER BY id')
        .all()
        .map((r) => ({ ...r }))
    ).toEqual([
      { sender_run_id: 'run-1', state: 'pending' },
      { sender_run_id: 'run-2', state: 'pending' }
    ])
  })

  it('V10 adds the env columns to runs, empty on the runs a V9 database already had', () => {
    const db = openDb()
    migrate(db, 9)
    db.exec(
      "INSERT INTO runs (id, automation_id, item_key, item_label, status, started_at) VALUES ('r1', 'a', 'k', 'l', 'done', 1)"
    )
    migrate(db)
    expect(columnsOf(db, 'runs')).toEqual(
      expect.arrayContaining([
        'home_path',
        'env_state',
        'env_mode',
        'env_reason',
        'env_path',
        'env_json',
        'env_removed_at',
        'env_delete_error',
        'env_delete_attempts',
        'env_retry_at',
        'home_hold_step'
      ])
    )
    expect(firstRow(db, 'SELECT home_path, env_state, env_delete_attempts FROM runs')).toEqual({
      home_path: null,
      env_state: null,
      env_delete_attempts: 0
    })
  })

  it('V11 deletes the dry-run ticks a V10 database stored, with their items, and drops the column', () => {
    const db = openDb()
    migrate(db, 10)
    db.exec(`
      INSERT INTO ticks (id, automation_id, started_at, dry_run, status) VALUES (1, 'a', 1, 0, 'ok'), (2, 'a', 2, 1, 'ok');
      INSERT INTO tick_items (tick_id, item_key, label, verdict, reason, checks_json, fields_json)
        VALUES (1, 'k', 'l', 'started', 'r', '[]', '{}'), (2, 'k', 'l', 'started', 'r', '[]', '{}');
    `)
    migrate(db)
    expect(
      db
        .prepare('SELECT id FROM ticks')
        .all()
        .map((r) => r.id)
    ).toEqual([1])
    expect(
      db
        .prepare('SELECT tick_id FROM tick_items')
        .all()
        .map((r) => r.tick_id)
    ).toEqual([1])
    expect(columnsOf(db, 'ticks')).not.toContain('dry_run')
  })

  it('V12 adds result_json to steps, empty (NULL) on the steps a V11 database already had', () => {
    const db = openDb()
    migrate(db, 11)
    db.exec(
      "INSERT INTO runs (id, automation_id, item_key, item_label, status, started_at) VALUES ('r1', 'a', 'k', 'l', 'done', 1)"
    )
    db.exec(
      "INSERT INTO steps (run_id, idx, name, agent, status) VALUES ('r1', 0, 'context', 'shell', 'done')"
    )
    migrate(db)
    expect(db.pragma('user_version', { simple: true })).toBe(15)
    expect(firstRow(db, 'SELECT result_json FROM steps')).toEqual({ result_json: null })
  })

  it('leaves a database migrated by a newer process unchanged', () => {
    const db = openDb()
    migrate(db)
    db.pragma(`user_version = ${PILOT_SCHEMA_VERSION + 1}`)
    migrate(db)
    expect(db.pragma('user_version', { simple: true })).toBe(PILOT_SCHEMA_VERSION + 1)
  })

  it('does nothing to a database that is already current', () => {
    const db = openDb()
    migrate(db)
    expect(() => migrate(db)).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(PILOT_SCHEMA_VERSION)
  })

  it('V13 adds runs.acknowledged_at, acknowledging ended runs without open defaults, and frees runs held only by defaults', () => {
    const db = openDb()
    migrate(db, 12)
    const run = db.prepare(
      "INSERT INTO runs (id, automation_id, item_key, item_label, status, outcome, started_at, finished_at) VALUES (?, 'a', 'k', 'k', ?, ?, 1, ?)"
    )
    run.run('done', 'done', 'Done', 10)
    run.run('live', 'running', null, null)
    run.run('held', 'needs_you', 'Inbox: 1 open item', null)
    run.run('asks', 'needs_you', 'Inbox: 1 open item', 20)
    const card = db.prepare(
      "INSERT INTO inbox_items (id, automation_id, run_id, person, type, title, digest, created_at, updated_at) VALUES (?, 'a', ?, 'nish', ?, 't', 'd', 1, 1)"
    )
    card.run('c1', 'held', 'default')
    card.run('c2', 'asks', 'question')
    migrate(db)
    const rows = db
      .prepare('SELECT id, status, outcome, acknowledged_at FROM runs ORDER BY id')
      .all()
    expect(rows.map((r: Record<string, unknown>) => ({ ...r }))).toEqual([
      { id: 'asks', status: 'needs_you', outcome: 'Inbox: 1 open item', acknowledged_at: 20 },
      { id: 'done', status: 'done', outcome: 'Done', acknowledged_at: 10 },
      { id: 'held', status: 'done', outcome: 'Done', acknowledged_at: null },
      { id: 'live', status: 'running', outcome: null, acknowledged_at: null }
    ])
    const plan = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM runs WHERE acknowledged_at IS NULL AND status IN ('done') AND COALESCE(finished_at, started_at) >= ? ORDER BY COALESCE(finished_at, started_at) DESC LIMIT 10"
      )
      .all(0) as { detail: string }[]
    expect(plan.map((p) => p.detail).join(' ')).toContain('runs_unacknowledged')
  })

  it('V15 adds runs.queued_at, empty on the runs a V14 database had', () => {
    const db = openDb()
    migrate(db, 14)
    db.exec(
      "INSERT INTO runs (id, automation_id, item_key, item_label, status, started_at, finished_at) VALUES ('r1', 'a', 'k', 'k', 'done', 1, 2)"
    )
    migrate(db)
    expect(firstRow(db, 'SELECT queued_at FROM runs')).toEqual({ queued_at: null })
  })

  it('V14 adds the settings and run queue tables, and runs.peak_rss_bytes empty on the runs a V13 database had', () => {
    const db = openDb()
    migrate(db, 13)
    db.exec(
      "INSERT INTO runs (id, automation_id, item_key, item_label, status, started_at) VALUES ('r1', 'a', 'k', 'k', 'running', 1)"
    )
    migrate(db)
    expect(firstRow(db, 'SELECT peak_rss_bytes FROM runs')).toEqual({ peak_rss_bytes: null })
    expect(columnsOf(db, 'settings')).toEqual(['key', 'value', 'updated_at'])
    expect(columnsOf(db, 'run_queue')).toEqual([
      'automation_id',
      'item_key',
      'item_label',
      'queued_at',
      'by_hand'
    ])
  })
})
