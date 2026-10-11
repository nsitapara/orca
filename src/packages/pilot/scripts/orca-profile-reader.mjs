// Read one app's profile state without changing anything beside it. Returns a Map of
// top-level domain -> JSON payload text, the shape upstream's profile-state export joins
// (src/main/persistence/profile-state/profile-state-documents.ts readProfileStateSnapshot).
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DATA_FILE = 'orca-data.json'
const DB_FILE = 'profile-state.db'

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}


// Loaded like upstream's sync-database.ts, so a runtime without node:sqlite (Bun) fails with a
// clear message when a database is opened, not when this module is imported.
function openReadOnly(path) {
  const sqlite = process.getBuiltinModule?.('node:sqlite')
  if (sqlite === undefined) {
    throw new Error('node:sqlite is unavailable; run this script with Node 22.13 or newer')
  }
  return new sqlite.DatabaseSync(path, { readOnly: true })
}

function tableExists(db, name) {
  const row = db
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name)
  return row !== undefined
}

// automationRuns may live in its own table; rebuild the array an export would hold
// (profile-state-automation-runs-reader.ts). Returns the number of runs.
function readAutomationRuns(db, domains) {
  if (!tableExists(db, 'profile_state_automation_runs_meta')) {
    return 0
  }
  const meta = db
    .prepare(
      'SELECT presence, content_hash FROM profile_state_automation_runs_meta WHERE domain = ?'
    )
    .get('automationRuns')
  if (meta === undefined || meta.presence === 'document') {
    return 0
  }
  if (meta.presence === 'absent') {
    domains.delete('automationRuns')
    return 0
  }
  if (meta.presence === 'null') {
    domains.set('automationRuns', 'null')
    return 0
  }
  const payloads = db
    .prepare('SELECT payload FROM profile_state_automation_runs ORDER BY ordinal')
    .all()
    .map((row) => row.payload)
  const json = `[${payloads.join(',')}]`
  if (sha256(json) !== meta.content_hash) {
    throw new Error('automationRuns rows fail their aggregate hash check')
  }
  domains.set('automationRuns', json)
  return payloads.length
}

// One read transaction = one consistent snapshot, with upstream's per-row hash check.
function readDocuments(db) {
  db.exec('BEGIN')
  try {
    const meta = new Map(
      db
        .prepare('SELECT key, value FROM profile_state_meta')
        .all()
        .map((row) => [row.key, row.value])
    )
    const domains = new Map()
    const rows = db
      .prepare('SELECT domain, payload, content_hash FROM profile_state_documents ORDER BY rowid')
      .all()
    for (const row of rows) {
      if (sha256(row.payload) !== row.content_hash) {
        throw new Error(`profile state domain ${row.domain} fails its hash check`)
      }
      domains.set(row.domain, row.payload)
    }
    const automationRunCount = readAutomationRuns(db, domains)
    db.exec('COMMIT')
    return {
      revision: Number(meta.get('revision') ?? 0),
      profileId: meta.get('profile_id'),
      domains,
      automationRunCount
    }
  } catch (error) {
    if (db.isTransaction) {
      db.exec('ROLLBACK')
    }
    throw error
  }
}

// A live database (Orca, running) is read in place as an ordinary WAL reader, which creates no
// files. Otherwise a private copy is read, so nothing appears beside the original.
function readProfileDatabase(dbFile, { live }) {
  const inPlace = live && existsSync(`${dbFile}-wal`) && existsSync(`${dbFile}-shm`)
  let path = dbFile
  let scratch
  if (!inPlace) {
    scratch = mkdtempSync(join(tmpdir(), 'pilot-orca-import-'))
    path = join(scratch, DB_FILE)
    copyFileSync(dbFile, path)
    if (existsSync(`${dbFile}-wal`)) {
      copyFileSync(`${dbFile}-wal`, `${path}-wal`)
    }
  }
  const db = openReadOnly(path)
  try {
    return readDocuments(db)
  } finally {
    db.close()
    if (scratch !== undefined) {
      rmSync(scratch, { recursive: true, force: true })
    }
  }
}

function readProfileJson(dataFile) {
  const parsed = JSON.parse(readFileSync(dataFile, 'utf8'))
  if (!isRecord(parsed)) {
    throw new Error(`${dataFile} is not a JSON object`)
  }
  const domains = new Map(Object.entries(parsed).map(([key, value]) => [key, JSON.stringify(value)]))
  return { revision: null, domains, automationRunCount: 0 }
}

// Orca: SQLite when present, else a pre-SQLite orca-data.json.
export function readOrcaState(profileDir) {
  const dbFile = join(profileDir, DB_FILE)
  if (existsSync(dbFile)) {
    return { source: dbFile, ...readProfileDatabase(dbFile, { live: true }) }
  }
  const dataFile = join(profileDir, DATA_FILE)
  if (existsSync(dataFile)) {
    return { source: dataFile, ...readProfileJson(dataFile) }
  }
  throw new Error(`No Orca profile state in ${profileDir}`)
}

// Pilot: its database, else a JSON staged by an earlier run that Pilot has not loaded yet.
export function readPilotState(profileDir) {
  const dbFile = join(profileDir, DB_FILE)
  if (existsSync(dbFile)) {
    return { source: dbFile, ...readProfileDatabase(dbFile, { live: false }) }
  }
  const dataFile = join(profileDir, DATA_FILE)
  if (existsSync(dataFile)) {
    return { source: dataFile, ...readProfileJson(dataFile) }
  }
  return { source: null, revision: null, domains: new Map(), automationRunCount: 0 }
}
