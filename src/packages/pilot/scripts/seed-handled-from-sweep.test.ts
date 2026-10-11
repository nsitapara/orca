import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PilotStore } from '../src/main/store/store'
// @ts-expect-error -- .mjs script without type declarations
import { seedHandled } from './seed-handled-from-sweep.mjs'

// Bun has no node:sqlite; upstream runs its SQLite tests on Node.
const sqlite = process.getBuiltinModule?.('node:sqlite')

const ID = 'fix-failed-ci'
const MIGRATIONS = fileURLToPath(new URL('../src/main/store/migrations.ts', import.meta.url))

type Paths = { dir: string; dbFile: string; handledFile: string; migrationsFile: string }

// A Pilot database made by Pilot's own migrations, beside the sweep's handled.json.
function setup(handled: unknown): Paths {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-seed-'))
  const dbFile = join(dir, 'pilot-automations.db')
  PilotStore.open(dbFile).close()
  const handledFile = join(dir, 'handled.json')
  writeFileSync(handledFile, JSON.stringify(handled))
  return { dir, dbFile, handledFile, migrationsFile: MIGRATIONS }
}

const seed = (paths: Paths, apply: boolean) =>
  seedHandled({ ...paths, automationId: ID, apply, now: 1_000 })

function handledRows(dbFile: string): Record<string, unknown>[] {
  const db = new sqlite!.DatabaseSync(dbFile)
  try {
    return db
      .prepare('SELECT * FROM handled ORDER BY once_key')
      .all()
      .map((row) => ({ ...row }))
  } finally {
    db.close()
  }
}

function withDb(dbFile: string, sql: string): void {
  const db = new sqlite!.DatabaseSync(dbFile)
  db.exec(sql)
  db.close()
}

describe.skipIf(sqlite === undefined)('seedHandled', () => {
  it('dry run counts the keys it would add and writes nothing', () => {
    const paths = setup({ '1587': 2933991087 })
    expect(seed(paths, false)).toMatchObject({
      status: 'ok',
      apply: false,
      keys: ['1587:2933991087'],
      present: 0,
      missing: 1,
      added: 0
    })
    expect(handledRows(paths.dbFile)).toEqual([])
  })

  it('apply seeds each "<iid>": <pipeline> as <iid>:<pipeline> with run_id null, skipping other entries', () => {
    const paths = setup({ '1587': 2933991087, '1590': 2934000001, x: 5, '1591': null, '1592': '7' })
    const result = seed(paths, true)
    expect(result).toMatchObject({ status: 'ok', present: 0, missing: 2, added: 2 })
    // Object.entries lists integer-like keys first, in ascending order.
    expect(result.invalid).toEqual(['1591: null', '1592: "7"', 'x: 5'])
    expect(handledRows(paths.dbFile)).toEqual([
      {
        automation_id: ID,
        once_key: '1587:2933991087',
        run_id: null,
        at: 1_000,
        status: 'started',
        failed_at: null
      },
      {
        automation_id: ID,
        once_key: '1590:2934000001',
        run_id: null,
        at: 1_000,
        status: 'started',
        failed_at: null
      }
    ])
  })

  it('is idempotent and never replaces a key Pilot already holds', () => {
    const paths = setup({ '1587': 2933991087, '1590': 2934000001 })
    const store = PilotStore.open(paths.dbFile)
    store.markHandled(ID, '1587:2933991087', 'run-1', 5)
    store.close()
    expect(seed(paths, true)).toMatchObject({ present: 1, missing: 1, added: 1 })
    expect(seed(paths, true)).toMatchObject({ present: 2, missing: 0, added: 0 })
    expect(handledRows(paths.dbFile)).toEqual([
      {
        automation_id: ID,
        once_key: '1587:2933991087',
        run_id: 'run-1',
        at: 5,
        status: 'started',
        failed_at: null
      },
      {
        automation_id: ID,
        once_key: '1590:2934000001',
        run_id: null,
        at: 1_000,
        status: 'started',
        failed_at: null
      }
    ])
  })

  it.each([
    {
      name: 'the database is at another schema version',
      arrange: (p: Paths) => withDb(p.dbFile, 'PRAGMA user_version = 3'),
      reason: 'the database is at schema 3'
    },
    {
      name: "Pilot's migrations moved past the script",
      arrange: (p: Paths) => {
        p.migrationsFile = join(p.dir, 'migrations.ts')
        writeFileSync(p.migrationsFile, 'export const PILOT_SCHEMA_VERSION = 3\n')
      },
      reason: "Pilot's migrations are at schema 3"
    },
    {
      name: 'handled has other columns',
      arrange: (p: Paths) =>
        withDb(
          p.dbFile,
          'DROP TABLE handled; CREATE TABLE handled (automation_id TEXT, once_key TEXT, at INTEGER)'
        ),
      reason: 'handled has columns (automation_id, once_key, at)'
    }
  ])('refuses, writing nothing, when $name', ({ arrange, reason }) => {
    const paths = setup({ '1587': 2933991087 })
    arrange(paths)
    const result = seed(paths, true)
    expect(result.status).toBe('refused')
    expect(result.reasons.join('\n')).toContain(reason)
    expect(handledRows(paths.dbFile)).toEqual([])
  })

  it("refuses when Pilot's database doesn't exist, and doesn't create it", () => {
    const paths = setup({ '1587': 2933991087 })
    paths.dbFile = join(paths.dir, 'missing.db')
    expect(seed(paths, true)).toMatchObject({ status: 'refused' })
    expect(existsSync(paths.dbFile)).toBe(false)
  })
})
