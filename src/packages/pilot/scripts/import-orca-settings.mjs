// Import Nish's Orca profile state into Pilot: a whitelist of domains, never automations.
//
// Mechanism: Pilot's own startup migration does the import; this script only stages it.
// - Orca's authority is SQLite: <profile>/profile-state.db, table profile_state_documents, one
//   row per top-level state domain, each with a sha256 content_hash
//   (src/main/persistence/profile-state/profile-state-documents.ts). Orca's orca-data.json and
//   orca-data.json.sqlite-export.*.json are frozen copies from its migration or explicit exports.
// - A profile holding orca-data.json and no SQLite evidence is classified 'json-only'. At startup
//   bootstrapProfileStateAuthority() then runs migrateJsonOnlyProfile(): it normalizes the JSON
//   through Store (prepareLegacyProfileState) and publishes profile-state.db, the .authority
//   marker and a recovery export (profile-state-authority-bootstrap.ts, profile-state-migration.ts).
// - Evidence that blocks that import (profile-state-recovery-required.ts): profile-state.db and
//   its -wal/-shm/-journal, profile-state.db.authority, profile-state.db.backup.*.db and
//   orca-data.json.sqlite-export.*.json.
// So: copy and read Orca's rows (orca-profile-reader.mjs), check and merge the whitelist over
// Pilot's own state (orca-import-policy.mjs), rename Pilot's evidence aside with a timestamp
// suffix, and write the merged state as Pilot's orca-data.json.
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  writeSync
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { readOrcaState, readPilotState } from './orca-profile-reader.mjs'
import {
  assertImportable,
  buildImportState,
  folderSpellings,
  serializeState
} from './orca-import-policy.mjs'

const DATA_FILE = 'orca-data.json'
const BACKUP_TAG = 'pre-orca-import'
const FAILED_TAG = 'failed-orca-import'
const BACKUP_NAME = new RegExp(`\\.(${BACKUP_TAG}|${FAILED_TAG})-(\\d{8}T\\d{6}Z)$`)
const PILOT_EXECUTABLE_SUFFIX = 'Pilot.app/Contents/MacOS/Pilot'
const PILOT_LOCK_FILES = ['SingletonLock', 'orcad.lock']
const APP_SUPPORT = join(homedir(), 'Library', 'Application Support')

// Files whose presence decides how Pilot's startup loads the profile.
const STATE_FILE_PATTERNS = [
  /^profile-state\.db(-wal|-shm|-journal)?$/,
  /^profile-state\.db\.authority$/,
  /^profile-state\.db\.backup\..+\.db(-wal|-shm|-journal)?$/,
  /^orca-data\.json$/,
  /^orca-data\.json\.bak\.\d+$/,
  /^orca-data\.json\.sqlite-export\.\d+\.json$/
]

function pathExists(path) {
  // lstat: Electron's SingletonLock is a symlink to a host-pid string, so it never resolves.
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function namesIn(dir) {
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir)
}

export function listStateFiles(profileDir) {
  return namesIn(profileDir)
    .filter((name) => STATE_FILE_PATTERNS.some((pattern) => pattern.test(name)))
    .sort()
}

function writeFileDurable(path, text) {
  const temp = `${path}.importing-${process.pid}.tmp`
  try {
    const fd = openSync(temp, 'w', 0o600)
    try {
      writeSync(fd, text)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temp, path)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

// Rename [from, to] pairs in order. Refuses before touching anything if a target exists (unless
// an earlier pair moves that file away). If a rename fails, the ones already made are undone.
export function renameAll(pairs, rename = renameSync) {
  const sources = new Set(pairs.map(([from]) => from))
  for (const [, to] of pairs) {
    if (pathExists(to) && !sources.has(to)) {
      throw new Error(`${to} already exists; wait a second and run again`)
    }
  }
  const done = []
  try {
    for (const [from, to] of pairs) {
      rename(from, to)
      done.push([from, to])
    }
  } catch (error) {
    for (const [from, to] of done.toReversed()) {
      rename(to, from)
    }
    throw error
  }
  return done.map(([, to]) => to)
}

// Rename Pilot's state files aside, then write the merged state. Undo the renames on failure.
export function stageImport({ profileDir, json, stamp }) {
  mkdirSync(profileDir, { recursive: true })
  const pairs = listStateFiles(profileDir).map((name) => {
    const from = join(profileDir, name)
    return [from, `${from}.${BACKUP_TAG}-${stamp}`]
  })
  const backups = renameAll(pairs)
  try {
    writeFileDurable(join(profileDir, DATA_FILE), json)
  } catch (error) {
    renameAll(pairs.map(([from, to]) => [to, from]).toReversed())
    throw error
  }
  const left = listStateFiles(profileDir).filter((name) => name !== DATA_FILE)
  if (left.length > 0) {
    throw new Error(`Pilot state files remain and would block the import: ${left.join(', ')}`)
  }
  return backups
}

// Put a backup set back. Whatever is there now is renamed aside, never deleted, in the same
// rollback-safe batch.
export function restoreBackup({ profileDir, backupStamp, stamp }) {
  const suffix = `.${BACKUP_TAG}-${backupStamp}`
  const backups = namesIn(profileDir).filter((name) => name.endsWith(suffix))
  if (backups.length === 0) {
    throw new Error(`No files ending in ${suffix} in ${profileDir}`)
  }
  const setAside = listStateFiles(profileDir).map((name) => [
    join(profileDir, name),
    join(profileDir, `${name}.${FAILED_TAG}-${stamp}`)
  ])
  const restore = backups.map((name) => [
    join(profileDir, name),
    join(profileDir, name.slice(0, -suffix.length))
  ])
  renameAll([...setAside, ...restore])
  return { restored: restore.map(([, to]) => to), setAside: setAside.map(([, to]) => to) }
}

// Backup sets in Pilot's profile folder, oldest first.
export function listBackups(profileDir) {
  const sets = new Map()
  for (const name of namesIn(profileDir)) {
    const match = BACKUP_NAME.exec(name)
    if (match === null) {
      continue
    }
    const key = `${match[2]} ${match[1]}`
    const set = sets.get(key) ?? { stamp: match[2], kind: match[1], files: [] }
    set.files.push(name)
    sets.set(key, set)
  }
  return [...sets.values()].sort((a, b) => a.stamp.localeCompare(b.stamp))
}

export function findRunningPilot({ pilotDataDir, processPaths }) {
  const reasons = processPaths
    .filter((path) => path.endsWith(PILOT_EXECUTABLE_SUFFIX))
    .map((path) => `process ${path}`)
  for (const name of PILOT_LOCK_FILES) {
    const path = join(pilotDataDir, name)
    if (pathExists(path)) {
      reasons.push(`lock file ${path}`)
    }
  }
  return reasons
}

async function listProcessPaths() {
  // Loaded here so tests that inject a process list never need @orca/process-host.
  const { run } = await import('./run.mjs')
  const result = run('ps', ['-axww', '-o', 'comm='])
  if (result.code !== 0) {
    throw new Error(`ps failed: ${result.stderr.trim()}`)
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

// Compared with symlinks resolved too, so a --pilot-data link into Orca's folder is refused.
function assertSeparateFolders(orcaDataDir, pilotDataDir) {
  for (const orcaPath of folderSpellings(orcaDataDir)) {
    for (const pilotPath of folderSpellings(pilotDataDir)) {
      const orca = orcaPath.toLowerCase()
      const pilot = pilotPath.toLowerCase()
      if (pilot === orca || pilot.startsWith(`${orca}/`) || orca.startsWith(`${pilot}/`)) {
        throw new Error(`Pilot's data folder must be separate from Orca's (${orcaDataDir})`)
      }
    }
  }
}

export function formatStamp(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')
}

function list(values) {
  if (values.length === 0) {
    return '(none)'
  }
  return values.join(', ')
}

function printBackups(log, profileDir, sets) {
  if (sets.length === 0) {
    log(`No import backups in ${profileDir}`)
    return
  }
  log(`Import backups in ${profileDir} (oldest first):`)
  for (const set of sets) {
    const hint = set.kind === BACKUP_TAG ? `  (undo an import with --restore ${set.stamp})` : ''
    log(`  ${set.stamp}  ${set.kind}  ${set.files.length} files${hint}`)
  }
}

function printPlan({ log, orca, pilot, plan, files, stamp, pilotProfileDir }) {
  const orcaVersion = `schema ${orca.schemaVersion ?? 'n/a'}, revision ${orca.revision ?? 'n/a'}`
  log(`Orca source:  ${orca.source} (${orcaVersion})`)
  log(`Pilot source: ${pilot.source ?? '(no Pilot state yet)'}`)
  log(`Imported from Orca: ${list(plan.imported)}`)
  const c = plan.counts
  log(
    `Counts: repos ${c.repos}, projects ${c.projects}, projectHostSetups ${c.projectHostSetups}, ` +
      `worktreeMeta ${c.worktreeMeta}, sshTargets ${c.sshTargets}`
  )
  log(
    `Orca automations skipped: ${c.orcaAutomationsSkipped} (+ ${orca.automationRunCount} runs); ` +
      `Pilot's own automations kept: ${c.pilotAutomationsKept}`
  )
  log(`Orca domains skipped: ${list(plan.skipped)}`)
  log(`Pilot domains kept as they are: ${list(plan.keptFromPilot)}`)
  if (plan.dropped.length > 0) {
    log(`Whitelisted domains Orca lacks (Pilot's copy dropped): ${list(plan.dropped)}`)
  }
  log('Settings kept from Pilot (not imported):')
  for (const item of plan.settingsExcluded) {
    log(`  - ${item.key}: ${item.reason} -> ${item.kept}`)
  }
  if (plan.settingsUnknownToPilot.length > 0) {
    log(`Orca settings Pilot does not define yet (copied): ${list(plan.settingsUnknownToPilot)}`)
  }
  const versions = plan.schemaVersions
  if (versions.pilot !== undefined && versions.orca !== versions.pilot) {
    log(
      `Note: schemaVersion differs (Orca ${versions.orca}, Pilot ${versions.pilot}); Pilot's kept`
    )
  }
  log(`Pilot files renamed aside (suffix .${BACKUP_TAG}-${stamp}):`)
  for (const name of files) {
    log(`  - ${join(pilotProfileDir, name)}`)
  }
  log(`Then write: ${join(pilotProfileDir, DATA_FILE)}`)
}

export async function importOrcaSettings(options) {
  const log = options.log ?? console.log
  const stamp = formatStamp(options.now ?? new Date())
  assertSeparateFolders(options.orcaDataDir, options.pilotDataDir)
  const pilotProfileDir = join(options.pilotDataDir, 'profiles', options.profileId)
  if (options.list) {
    // Read-only, so it is allowed while Pilot runs.
    const backups = listBackups(pilotProfileDir)
    printBackups(log, pilotProfileDir, backups)
    return { status: 'listed', backups }
  }
  const listProcesses = options.listProcesses ?? listProcessPaths
  const running = findRunningPilot({
    pilotDataDir: options.pilotDataDir,
    processPaths: await listProcesses()
  })
  if (running.length > 0) {
    log('Pilot looks like it is running. Quit Pilot first. Found:')
    for (const reason of running) {
      log(`  - ${reason}`)
    }
    log('A lock file left behind by a crash can be deleted once you are sure Pilot is not running.')
    return { status: 'refused', reasons: running }
  }
  if (options.restore !== undefined) {
    const result = restoreBackup({
      profileDir: pilotProfileDir,
      backupStamp: options.restore,
      stamp
    })
    log(`Restored: ${list(result.restored)}`)
    log(`Set aside: ${list(result.setAside)}`)
    return { status: 'restored', ...result }
  }
  const orca = readOrcaState(join(options.orcaDataDir, 'profiles', options.profileId))
  const pilot = readPilotState(pilotProfileDir)
  assertImportable(orca, pilot)
  const plan = buildImportState({
    orca: orca.domains,
    pilot: pilot.domains,
    orcaDataDir: options.orcaDataDir
  })
  const files = listStateFiles(pilotProfileDir)
  printPlan({ log, orca, pilot, plan, files, stamp, pilotProfileDir })
  if (!options.apply) {
    log('Dry run: nothing changed. Run again with --apply to stage the import.')
    return { status: 'dry-run', plan, files }
  }
  const backups = stageImport({
    profileDir: pilotProfileDir,
    json: serializeState(plan.state),
    stamp
  })
  log(`Applied. Backups: ${list(backups)}`)
  log('Pilot imports the staged orca-data.json the next time it starts.')
  log(`To undo before or after that: --restore ${stamp}`)
  return { status: 'applied', plan, backups, stamp }
}

const HELP = `Usage: node src/packages/pilot/scripts/import-orca-settings.mjs [--dry-run | --apply | --restore <stamp> | --list]
  Copies Orca's settings, repos, projects, worktree metadata and SSH targets into Pilot.
  Never copies Orca's automations, UI state, sessions or terminals. Quit Pilot first.
  --dry-run            print what would change (the default)
  --apply              rename Pilot's state files aside and stage the import
  --restore <stamp>    put back the files an earlier --apply renamed aside
  --list               list the backup sets in Pilot's profile folder (works while Pilot runs)
  --profile <id>       profile in both apps (default local-default)
  --orca-data <dir>    Orca's data folder (default ~/Library/Application Support/orca)
  --pilot-data <dir>   Pilot's data folder (default ~/Library/Application Support/Pilot)`

const VALUE_FLAGS = {
  '--restore': 'restore',
  '--profile': 'profileId',
  '--orca-data': 'orcaDataDir',
  '--pilot-data': 'pilotDataDir'
}
const BOOLEAN_FLAGS = { '--apply': 'apply', '--list': 'list', '--help': 'help', '-h': 'help' }

export function parseArgs(argv) {
  const options = {
    apply: false,
    list: false,
    help: false,
    profileId: 'local-default',
    orcaDataDir: join(APP_SUPPORT, 'orca'),
    pilotDataDir: join(APP_SUPPORT, 'Pilot')
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
  const modes = [options.apply, options.restore !== undefined, options.list].filter(Boolean)
  if (modes.length > 1) {
    throw new Error('Use only one of --apply, --restore and --list')
  }
  return options
}

export async function runCli(argv) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    console.error(error.message)
    console.error(HELP)
    return 2
  }
  if (options.help) {
    console.log(HELP)
    return 0
  }
  try {
    const result = await importOrcaSettings(options)
    return result.status === 'refused' ? 1 : 0
  } catch (error) {
    console.error(`Import failed: ${error.message}`)
    return 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  process.exit(await runCli(process.argv.slice(2)))
}
