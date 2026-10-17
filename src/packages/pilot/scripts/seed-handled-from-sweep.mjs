#!/usr/bin/env node
// Seeds Pilot's `handled` table from the old ci-fix sweep's handled.json, so fix-failed-ci never
// retries a pipeline automation 05 already tried. Each `"<iid>": <pipeline id>` entry becomes the
// once_per key "<iid>:<pipeline>" (fix-failed-ci.yaml's once_per) with run_id null. It only adds
// keys and never replaces one Pilot already holds, so re-running it is safe: run it again right
// before cutover, since the sweep keeps adding entries until then.
//
// Pilot keeps its database open in WAL mode, so this runs while Pilot does. It refuses, writing
// nothing, when the database isn't the schema Pilot's migrations (src/main/store/migrations.ts)
// create, or when those migrations have moved past the schema this script writes into.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HELP = `Usage: node src/packages/pilot/scripts/seed-handled-from-sweep.mjs [--apply] [options]

Copies the old ci-fix sweep's handled pipelines into Pilot's handled table.
Without --apply it is a dry run: it prints the counts and writes nothing.

  --apply              insert the keys Pilot doesn't have yet
  --handled <file>     the sweep's handled.json
                       (default ~/Documents/web-platform/.git/agent-loops/ci-fix/handled.json)
  --db <file>          Pilot's database (default ~/Library/Application Support/Pilot/pilot-automations.db;
                       the dev app's is under pilot-dev)
  --automation <id>    the automation the keys belong to (default fix-failed-ci)`

// The schema this script writes into. When migrations.ts moves past it, check the handled insert
// below against the new schema, then raise this. V2 added status (DEFAULT 'started') and failed_at
// (NULL), which the insert leaves to their defaults: a seeded key is an attempt the sweep made.
// V3 added steps.launch_args_json only; handled is unchanged. V4 added step usage and V5 inbox_items'
// Details columns; V6 adds inbox preparation metadata, V7 a "Not prepared" notice's key, V8 a tick's warnings and V9
// the handovers table and a tick's trigger. All leave handled unchanged. V10 adds runs' env columns; handled is unchanged.
// V11 deletes the stored dry-run ticks and drops ticks.dry_run; handled is unchanged.
// V12 adds steps.result_json; handled is unchanged. V13 adds runs.acknowledged_at and its index; handled is unchanged.
// V14 adds the settings and run_queue tables and runs.peak_rss_bytes; handled is unchanged.
// V15 adds runs.queued_at and its index; V16 runs.idle_ms. handled is unchanged.
export const SEED_SCHEMA_VERSION = 16
const HANDLED_COLUMNS = ['automation_id', 'once_key', 'run_id', 'at', 'status', 'failed_at']
const BUSY_TIMEOUT_MS = 5000
const MIGRATIONS_FILE = fileURLToPath(new URL('../src/main/store/migrations.ts', import.meta.url))

function failure(error) {
  return error.code ?? error.message
}

// handled.json is gate.save's `{ "<iid>": <pipeline id> }`. Anything else is reported, not seeded.
export function readSweepHandled(file) {
  let data
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`Can't read ${file}: ${failure(error)}`)
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${file}: expected an object of "<iid>": <pipeline id>`)
  }
  const keys = []
  const invalid = []
  for (const [iid, pipeline] of Object.entries(data)) {
    if (/^\d+$/.test(iid) && Number.isSafeInteger(pipeline) && pipeline > 0) {
      keys.push(`${iid}:${pipeline}`)
    } else {
      invalid.push(`${iid}: ${JSON.stringify(pipeline)}`)
    }
  }
  return { keys, invalid }
}

export function migrationsSchemaVersion(file) {
  const match = /export const PILOT_SCHEMA_VERSION = (\d+)/.exec(readFileSync(file, 'utf8'))
  if (!match) {
    throw new Error(`${file} doesn't declare PILOT_SCHEMA_VERSION`)
  }
  return Number(match[1])
}

// Loaded like orca-profile-reader.mjs, so a runtime without node:sqlite (Bun) fails with a clear message.
function openDatabase(file, apply) {
  const sqlite = process.getBuiltinModule?.('node:sqlite')
  if (sqlite === undefined) {
    throw new Error('node:sqlite is unavailable; run this script with Node 22.16 or newer')
  }
  const db = new sqlite.DatabaseSync(file, { readOnly: !apply, timeout: BUSY_TIMEOUT_MS })
  // Why first: Pilot holds this database open in WAL mode, so any statement below can meet its lock.
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
  return db
}

function schemaProblems(db, migrationsVersion) {
  const problems = []
  if (migrationsVersion !== SEED_SCHEMA_VERSION) {
    problems.push(
      `Pilot's migrations are at schema ${migrationsVersion}; this script was written for ${SEED_SCHEMA_VERSION}`
    )
  }
  const version = db.prepare('PRAGMA user_version').get().user_version
  if (version !== migrationsVersion) {
    problems.push(
      `the database is at schema ${version}; Pilot's migrations create ${migrationsVersion}`
    )
  }
  const columns = db
    .prepare('PRAGMA table_info(handled)')
    .all()
    .map((column) => column.name)
  if (columns.join(',') !== HANDLED_COLUMNS.join(',')) {
    const found = columns.length ? columns.join(', ') : 'no handled table'
    problems.push(`handled has columns (${found}); expected (${HANDLED_COLUMNS.join(', ')})`)
  }
  return problems
}

function insertMissing(db, automationId, keys, now) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO handled (automation_id, once_key, run_id, at) VALUES (?, ?, NULL, ?)'
  )
  let added = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const key of keys) {
      added += Number(insert.run(automationId, key, now).changes)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return added
}

// { status: 'refused', reasons } or { status: 'ok', apply, keys, invalid, present, missing, added }.
// present/missing: the keys Pilot held, or didn't, before this run. added: rows inserted (0 on a dry run).
export function seedHandled({
  handledFile,
  dbFile,
  migrationsFile = MIGRATIONS_FILE,
  automationId,
  apply,
  now = Date.now()
}) {
  const { keys, invalid } = readSweepHandled(handledFile)
  if (!existsSync(dbFile)) {
    return {
      status: 'refused',
      reasons: [`${dbFile} doesn't exist; start Pilot once so it creates it`]
    }
  }
  const migrationsVersion = migrationsSchemaVersion(migrationsFile)
  const db = openDatabase(dbFile, apply)
  try {
    const reasons = schemaProblems(db, migrationsVersion)
    if (reasons.length) {
      return { status: 'refused', reasons }
    }
    const held = db.prepare(
      'SELECT 1 AS found FROM handled WHERE automation_id = ? AND once_key = ?'
    )
    const present = keys.filter((key) => held.get(automationId, key) !== undefined).length
    const added = apply ? insertMissing(db, automationId, keys, now) : 0
    return { status: 'ok', apply, keys, invalid, present, missing: keys.length - present, added }
  } finally {
    db.close()
  }
}

const APP_SUPPORT = join(homedir(), 'Library', 'Application Support')
const VALUE_FLAGS = { '--handled': 'handledFile', '--db': 'dbFile', '--automation': 'automationId' }
const BOOLEAN_FLAGS = { '--apply': 'apply', '--help': 'help', '-h': 'help' }

export function parseArgs(argv) {
  const options = {
    apply: false,
    help: false,
    handledFile: join(homedir(), 'Documents/web-platform/.git/agent-loops/ci-fix/handled.json'),
    dbFile: join(APP_SUPPORT, 'Pilot', 'pilot-automations.db'),
    automationId: 'fix-failed-ci'
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') {
      options.apply = false
    } else if (Object.hasOwn(BOOLEAN_FLAGS, arg)) {
      options[BOOLEAN_FLAGS[arg]] = true
    } else if (Object.hasOwn(VALUE_FLAGS, arg) && argv[index + 1] !== undefined) {
      options[VALUE_FLAGS[arg]] = argv[index + 1]
      index += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }
  return options
}

function printSummary(result, options, log) {
  if (!result.apply) {
    log('Dry run: nothing written. Add --apply to write.')
  }
  log(`handled.json: ${options.handledFile}`)
  log(`  ${result.keys.length} pipeline(s): ${result.keys.join(', ') || '(none)'}`)
  if (result.invalid.length) {
    log(`  skipped, not "<iid>": <pipeline id>: ${result.invalid.join(', ')}`)
  }
  log(`Pilot: ${options.dbFile} (automation ${options.automationId})`)
  log(`  already handled: ${result.present}`)
  if (result.apply) {
    log(`  added: ${result.added}`)
  } else {
    log(`  would add: ${result.missing}`)
  }
}

export function runCli(argv, log = console.log, logError = console.error) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    logError(error.message)
    logError(HELP)
    return 2
  }
  if (options.help) {
    log(HELP)
    return 0
  }
  let result
  try {
    result = seedHandled(options)
  } catch (error) {
    logError(`Seeding failed, nothing written: ${error.message}`)
    return 1
  }
  if (result.status === 'refused') {
    logError('Refused, nothing written:')
    for (const reason of result.reasons) {
      logError(`  - ${reason}`)
    }
    return 1
  }
  printSummary(result, options, log)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  process.exit(runCli(process.argv.slice(2)))
}
