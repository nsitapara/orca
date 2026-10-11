// Pilot's own record of which Orca automations the mover has copied, so a retry finds its copy
// even after either side was renamed. It lives in Pilot's folder and never in Orca's (R14).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const DEFAULT_RECORD_FILE = join(
  homedir(),
  'Library',
  'Application Support',
  'Pilot',
  'moved-automations.json'
)

// Orca's data folders. Compared lower-cased because macOS folds case.
function orcaFolders() {
  return [join(homedir(), '.orca'), join(homedir(), 'Library', 'Application Support', 'orca')].map(
    (folder) => `${folder.toLowerCase()}/`
  )
}

function assertPilotOwned(file) {
  const target = `${resolve(file).toLowerCase()}/`
  if (orcaFolders().some((folder) => target.startsWith(folder))) {
    throw new Error(`${file} is inside Orca's data folder; Pilot never writes there`)
  }
}

// `{ "<orcaId>": { pilotId, name, movedAt, state } }`. A missing file is empty; a corrupt one is
// an error, so a retry never overwrites records it couldn't read.
export function readRecords(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {}
    }
    throw new Error(`Can't read ${file}: ${error.code ?? error.message}`)
  }
  try {
    const data = JSON.parse(text)
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('not an object')
    }
    return data
  } catch (error) {
    throw new Error(`${file} isn't a valid move record (${error.message}); fix or move it aside`)
  }
}

// Write-then-rename in the same folder, so a crash never leaves a half-written file.
export function writeRecord(file, orcaId, entry) {
  assertPilotOwned(file)
  const records = readRecords(file)
  records[orcaId] = { ...records[orcaId], ...entry }
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(records, null, 2)}\n`)
  renameSync(temp, file)
}

export function removeRecord(file, orcaId) {
  assertPilotOwned(file)
  const records = readRecords(file)
  if (!Object.hasOwn(records, orcaId)) {
    return
  }
  delete records[orcaId]
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(records, null, 2)}\n`)
  renameSync(temp, file)
}
