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
      'inbox_items',
      'queue',
      'runs',
      'seen',
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

  it('moves a v4 database to v5: a card gains its Details ref and snapshot, none on existing rows', () => {
    const db = openDb()
    migrate(db, 4)
    db.exec(
      "INSERT INTO inbox_items (id, automation_id, person, type, title, digest, created_at, updated_at) VALUES ('i1', 'a', 'p', 'question', 't', 'd', 1, 1)"
    )
    migrate(db)
    expect(PILOT_SCHEMA_VERSION).toBe(6)
    expect(db.pragma('user_version', { simple: true })).toBe(6)
    expect(
      firstRow(
        db,
        'SELECT id, details_ref_json, details_snapshot_json, preparation_json FROM inbox_items'
      )
    ).toEqual({
      id: 'i1',
      details_ref_json: null,
      details_snapshot_json: null,
      preparation_json: null
    })
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
})
