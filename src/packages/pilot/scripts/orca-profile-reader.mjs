// Read one app's profile state without writing anything beside it. Returns a Map of
// top-level domain -> JSON payload text, the shape upstream's profile-state export joins
// (src/main/persistence/profile-state/profile-state-documents.ts readProfileStateSnapshot),
// plus each domain's stored domain_version.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DATA_FILE = 'orca-data.json'
const DB_FILE = 'profile-state.db'
const COPY_ATTEMPTS = 5

// PROFILE_STATE_DATABASE_SCHEMA_VERSION (profile-state-database-schema.ts), stored as
// PRAGMA user_version. Another version may lay rows out differently: refuse it.
export const SUPPORTED_SCHEMA_VERSIONS = [3]

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// A finite wait on a lock, like every SQLite open in Pilot; it reads a private copy, so it rarely waits.
const BUSY_TIMEOUT_MS = 5000

// Loaded like upstream's sync-database.ts, so a runtime without node:sqlite (Bun) fails with a
// clear message when a database is opened, not when this module is imported.
function openReadOnly(path) {
  const sqlite = process.getBuiltinModule?.('node:sqlite')
  if (sqlite === undefined) {
    throw new Error('node:sqlite is unavailable; run this script with Node 22.16 or newer')
  }
  return new sqlite.DatabaseSync(path, { readOnly: true, timeout: BUSY_TIMEOUT_MS })
}

function tableExists(db, name) {
  const row = db
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name)
  return row !== undefined
}

// automationRuns may live in its own table; rebuild the array an export would hold
// (profile-state-automation-runs-reader.ts). Returns the number of runs.
function readAutomationRuns(db, domains, versions) {
  if (!tableExists(db, 'profile_state_automation_runs_meta')) {
    return 0
  }
  const meta = db
    .prepare(
      `SELECT presence, domain_version, content_hash FROM profile_state_automation_runs_meta
       WHERE domain = ?`
    )
    .get('automationRuns')
  if (meta === undefined || meta.presence === 'document') {
    return 0
  }
  versions.set('automationRuns', meta.domain_version)
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
function readDocuments(db, label) {
  const schemaVersion = Number(db.prepare('PRAGMA user_version').get().user_version)
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)) {
    throw new Error(
      `${label} uses profile-state schema ${schemaVersion}; this script knows ` +
        `${SUPPORTED_SCHEMA_VERSIONS.join(', ')}. Update the script from upstream's ` +
        'profile-state code before importing.'
    )
  }
  db.exec('BEGIN')
  try {
    const meta = new Map(
      db
        .prepare('SELECT key, value FROM profile_state_meta')
        .all()
        .map((row) => [row.key, row.value])
    )
    const domains = new Map()
    const versions = new Map()
    const rows = db
      .prepare(
        `SELECT domain, payload, domain_version, content_hash FROM profile_state_documents
         ORDER BY rowid`
      )
      .all()
    for (const row of rows) {
      if (sha256(row.payload) !== row.content_hash) {
        throw new Error(`profile state domain ${row.domain} fails its hash check`)
      }
      domains.set(row.domain, row.payload)
      versions.set(row.domain, row.domain_version)
    }
    const automationRunCount = readAutomationRuns(db, domains, versions)
    db.exec('COMMIT')
    return {
      schemaVersion,
      revision: Number(meta.get('revision') ?? 0),
      profileId: meta.get('profile_id'),
      domains,
      versions,
      automationRunCount
    }
  } catch (error) {
    if (db.isTransaction) {
      db.exec('ROLLBACK')
    }
    throw error
  }
}

function fileStamp(path) {
  try {
    const stat = statSync(path, { bigint: true })
    return `${stat.ino}:${stat.size}:${stat.mtimeNs}`
  } catch {
    return 'absent'
  }
}

// Copy the database and its WAL into `scratch`, never opening the originals: even a read-only
// SQLite reader writes read marks into the live -shm. If any source changed during the copy
// (a commit, a checkpoint, a WAL reset), copy again. Without -shm, SQLite rebuilds the WAL index
// from the copied WAL's valid commit frames when the copy is opened.
function snapshotDatabase(dbFile, scratch) {
  const sources = [dbFile, `${dbFile}-wal`]
  const targets = [join(scratch, DB_FILE), join(scratch, `${DB_FILE}-wal`)]
  for (let attempt = 0; attempt < COPY_ATTEMPTS; attempt += 1) {
    const before = sources.map(fileStamp)
    sources.forEach((source, index) => {
      rmSync(targets[index], { force: true })
      if (existsSync(source)) {
        copyFileSync(source, targets[index])
      }
    })
    if (sources.map(fileStamp).join('|') === before.join('|')) {
      return targets[0]
    }
  }
  throw new Error(`${dbFile} kept changing while it was copied; run the script again`)
}

function readProfileDatabase(dbFile) {
  const scratch = mkdtempSync(join(tmpdir(), 'pilot-orca-import-'))
  try {
    const db = openReadOnly(snapshotDatabase(dbFile, scratch))
    try {
      return readDocuments(db, dbFile)
    } finally {
      db.close()
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

// A JSON source has no stored domain versions; its shapes are still checked by the caller.
function readProfileJson(dataFile) {
  const parsed = JSON.parse(readFileSync(dataFile, 'utf8'))
  if (!isRecord(parsed)) {
    throw new Error(`${dataFile} is not a JSON object`)
  }
  const domains = new Map(
    Object.entries(parsed).map(([key, value]) => [key, JSON.stringify(value)])
  )
  return {
    schemaVersion: null,
    revision: null,
    domains,
    versions: new Map(),
    automationRunCount: 0
  }
}

function readProfile(profileDir) {
  const dbFile = join(profileDir, DB_FILE)
  if (existsSync(dbFile)) {
    return { source: dbFile, ...readProfileDatabase(dbFile) }
  }
  const dataFile = join(profileDir, DATA_FILE)
  if (existsSync(dataFile)) {
    return { source: dataFile, ...readProfileJson(dataFile) }
  }
  return undefined
}

// Orca: SQLite when present, else a pre-SQLite orca-data.json.
export function readOrcaState(profileDir) {
  const state = readProfile(profileDir)
  if (state === undefined) {
    throw new Error(`No Orca profile state in ${profileDir}`)
  }
  return state
}

// Pilot: its database, else a JSON staged by an earlier run that Pilot has not loaded yet.
export function readPilotState(profileDir) {
  const empty = { schemaVersion: null, revision: null, versions: new Map(), automationRunCount: 0 }
  return readProfile(profileDir) ?? { source: null, domains: new Map(), ...empty }
}
