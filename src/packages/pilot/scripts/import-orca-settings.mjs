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
// So: read Orca's rows (read-only, orca-profile-reader.mjs), merge the whitelist over Pilot's own
// state, rename Pilot's evidence aside with a timestamp suffix, and write the merged state as
// Pilot's orca-data.json.
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
import { isRecord, readOrcaState, readPilotState } from './orca-profile-reader.mjs'

const DATA_FILE = 'orca-data.json'
const BACKUP_TAG = 'pre-orca-import'
const FAILED_TAG = 'failed-orca-import'
const PILOT_EXECUTABLE_SUFFIX = 'Pilot.app/Contents/MacOS/Pilot'
const PILOT_LOCK_FILES = ['SingletonLock', 'orcad.lock']
const APP_SUPPORT = join(homedir(), 'Library', 'Application Support')

// Copied from Orca. Each one replaces Pilot's value; if Orca lacks one, Pilot's copy is dropped
// so loading falls back to the default. Everything else keeps Pilot's own value.
export const IMPORTED_DOMAINS = [
  'settings',
  'repos',
  'projects',
  'projectHostSetups',
  'projectGroups',
  'folderWorkspaces',
  // Stored beside folderWorkspaces: their diff comments are split out on save.
  'folderWorkspaceDiffComments',
  'sparsePresetsByRepo',
  'sshTargets',
  'sshTargetGenerationCounter',
  'deletedSshConfigAliases',
  'worktreeMeta',
  'worktreeMetaByIdentity',
  'worktreeIdentityAliases',
  'worktreeLineageById',
  'workspaceLineageByChildKey',
  'retiredWorktreeNamesByRepo',
  'retiredWorktreeNamesByNamespace',
  'onboarding'
]

// Must never come from Orca. Orca's automations would run in Pilot too and launch agents twice.
export const NEVER_IMPORTED_DOMAINS = [
  'automations',
  'automationRuns',
  'ui',
  'workspaceSession',
  'workspaceSessionsByHostId',
  'claudeLivePtySessionIds',
  'sshRemotePtyLeases',
  'sshPtyConsumerRecoveries',
  'mobileClientTabSelectionsByDeviceId',
  'featureInteractionTelemetryBuckets',
  'codexResetCreditAttemptLedger',
  'migrationUnsupportedPtyEntries',
  'legacyPaneKeyAliasEntries'
]

for (const domain of IMPORTED_DOMAINS) {
  if (NEVER_IMPORTED_DOMAINS.includes(domain)) {
    throw new Error(`${domain} is both imported and never imported`)
  }
}

// Settings that would make Pilot collide with or impersonate Orca. They keep Pilot's value.
export const EXCLUDED_SETTINGS = {
  telemetry: "holds Orca's installId; each app keeps its own install identity and opt-in",
  machineName: 'the host name paired phones and browsers see; Pilot must not present as Orca',
  mobilePairingCustomAddress: "a pairing endpoint that can carry Orca's host:port (6768)",
  mobilePairingCustomAddresses: "pairing endpoints that can carry Orca's host:port (6768)",
  opencodeSessionCookie: "sealed with Orca's safeStorage key, which Pilot cannot decrypt",
  opencodeGoApiKey: "legacy secret sealed with Orca's safeStorage key",
  httpProxyUrl: "sealed with Orca's safeStorage key, which Pilot cannot decrypt",
  claudeManagedAccounts: "account records point at auth folders inside Orca's data folder",
  codexManagedAccounts: "account records point at home folders inside Orca's data folder",
  activeClaudeManagedAccountId: 'selects one of Orca managed accounts (excluded)',
  activeCodexManagedAccountId: 'selects one of Orca managed accounts (excluded)',
  activeClaudeManagedAccountIdsByRuntime: 'selects Orca managed accounts (excluded)',
  activeCodexManagedAccountIdsByRuntime: 'selects Orca managed accounts (excluded)'
}
const ORCA_FOLDER_REASON = "a value points into Orca's data folder"

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

// Lower-cased spellings of Orca's data folder: absolute, and ~-relative when under home.
function folderNeedles(folder) {
  const absolute = resolve(folder)
  const needles = [absolute.toLowerCase()]
  if (absolute.startsWith(`${homedir()}/`)) {
    needles.push(`~${absolute.slice(homedir().length)}`.toLowerCase())
  }
  return needles
}

function pointsInto(value, needles) {
  if (typeof value === 'string') {
    const lower = value.toLowerCase()
    return needles.some((needle) => lower.includes(needle))
  }
  if (Array.isArray(value)) {
    return value.some((item) => pointsInto(item, needles))
  }
  if (isRecord(value)) {
    return Object.values(value).some((item) => pointsInto(item, needles))
  }
  return false
}

function exclusionReason(key, value, orcaDataDir) {
  if (Object.hasOwn(EXCLUDED_SETTINGS, key)) {
    return EXCLUDED_SETTINGS[key]
  }
  if (pointsInto(value, folderNeedles(orcaDataDir))) {
    return ORCA_FOLDER_REASON
  }
  return undefined
}

// Orca's settings win, except the excluded ones, which keep Pilot's value (or its default).
export function mergeSettings(orcaSettings, pilotSettings, orcaDataDir) {
  const settings = { ...pilotSettings }
  const excluded = []
  for (const [key, value] of Object.entries(orcaSettings)) {
    const reason = exclusionReason(key, value, orcaDataDir)
    if (reason === undefined) {
      settings[key] = value
      continue
    }
    const kept = Object.hasOwn(pilotSettings, key) ? "Pilot's current value" : "Pilot's default"
    excluded.push({ key, reason, kept })
  }
  return { settings, excluded }
}

function parseDomain(domains, name) {
  const payload = domains.get(name)
  if (payload === undefined) {
    return undefined
  }
  return JSON.parse(payload)
}

function countOf(domains, name) {
  const value = parseDomain(domains, name)
  if (Array.isArray(value)) {
    return value.length
  }
  if (isRecord(value)) {
    return Object.keys(value).length
  }
  return 0
}

// orca and pilot are Maps of domain -> JSON payload text. Returns the merged state and a report.
export function buildImportState({ orca, pilot, orcaDataDir }) {
  const state = new Map(pilot)
  const imported = []
  const dropped = []
  for (const domain of IMPORTED_DOMAINS) {
    if (domain === 'settings') {
      continue
    }
    if (orca.has(domain)) {
      state.set(domain, orca.get(domain))
      imported.push(domain)
    } else if (state.delete(domain)) {
      dropped.push(domain)
    }
  }
  let settingsExcluded = []
  if (orca.has('settings')) {
    const pilotSettings = parseDomain(pilot, 'settings') ?? {}
    const merged = mergeSettings(parseDomain(orca, 'settings'), pilotSettings, orcaDataDir)
    state.set('settings', JSON.stringify(merged.settings))
    settingsExcluded = merged.excluded
    imported.unshift('settings')
  }
  if (!state.has('schemaVersion') && orca.has('schemaVersion')) {
    state.set('schemaVersion', orca.get('schemaVersion'))
  }
  const excludedKeys = new Set(settingsExcluded.map((item) => item.key))
  const copiedSettings = Object.keys(parseDomain(orca, 'settings') ?? {}).filter(
    (key) => !excludedKeys.has(key)
  )
  const pilotSettings = parseDomain(pilot, 'settings')
  return {
    state,
    imported,
    dropped,
    skipped: [...orca.keys()].filter((d) => d !== 'schemaVersion' && !imported.includes(d)),
    keptFromPilot: [...pilot.keys()].filter((d) => !IMPORTED_DOMAINS.includes(d)),
    settingsExcluded,
    settingsUnknownToPilot:
      pilotSettings === undefined
        ? []
        : copiedSettings.filter((key) => !Object.hasOwn(pilotSettings, key)),
    schemaVersions: { orca: orca.get('schemaVersion'), pilot: pilot.get('schemaVersion') },
    counts: {
      repos: countOf(state, 'repos'),
      projects: countOf(state, 'projects'),
      projectHostSetups: countOf(state, 'projectHostSetups'),
      worktreeMeta: countOf(state, 'worktreeMeta'),
      sshTargets: countOf(state, 'sshTargets'),
      orcaAutomationsSkipped: countOf(orca, 'automations'),
      pilotAutomationsKept: countOf(state, 'automations')
    }
  }
}

// The same shape upstream's export writes: {"domain":payload,...}.
export function serializeState(state) {
  const parts = [...state].map(([domain, payload]) => `${JSON.stringify(domain)}:${payload}`)
  return `{${parts.join(',')}}`
}

export function listStateFiles(profileDir) {
  if (!existsSync(profileDir)) {
    return []
  }
  return readdirSync(profileDir)
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

function renameAll(profileDir, names, suffix) {
  const moved = []
  for (const name of names) {
    if (pathExists(join(profileDir, `${name}${suffix}`))) {
      throw new Error(`${name}${suffix} already exists; wait a second and run again`)
    }
  }
  for (const name of names) {
    const from = join(profileDir, name)
    renameSync(from, `${from}${suffix}`)
    moved.push(`${from}${suffix}`)
  }
  return moved
}

// Rename Pilot's state files aside, then write the merged state. Undo the renames on failure.
export function stageImport({ profileDir, json, stamp }) {
  mkdirSync(profileDir, { recursive: true })
  const suffix = `.${BACKUP_TAG}-${stamp}`
  const backups = renameAll(profileDir, listStateFiles(profileDir), suffix)
  try {
    writeFileDurable(join(profileDir, DATA_FILE), json)
  } catch (error) {
    for (const backup of backups.toReversed()) {
      renameSync(backup, backup.slice(0, -suffix.length))
    }
    throw error
  }
  const left = listStateFiles(profileDir).filter((name) => name !== DATA_FILE)
  if (left.length > 0) {
    throw new Error(`Pilot state files remain and would block the import: ${left.join(', ')}`)
  }
  return backups
}

// Put a backup set back. Whatever is there now is renamed aside, never deleted.
export function restoreBackup({ profileDir, backupStamp, stamp }) {
  const suffix = `.${BACKUP_TAG}-${backupStamp}`
  const names = existsSync(profileDir) ? readdirSync(profileDir) : []
  const backups = names.filter((name) => name.endsWith(suffix))
  if (backups.length === 0) {
    throw new Error(`No files ending in ${suffix} in ${profileDir}`)
  }
  const setAside = renameAll(profileDir, listStateFiles(profileDir), `.${FAILED_TAG}-${stamp}`)
  const restored = backups.map((name) => {
    const target = join(profileDir, name.slice(0, -suffix.length))
    renameSync(join(profileDir, name), target)
    return target
  })
  return { restored, setAside }
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

function assertSeparateFolders(orcaDataDir, pilotDataDir) {
  const orca = resolve(orcaDataDir).toLowerCase()
  const pilot = resolve(pilotDataDir).toLowerCase()
  if (pilot === orca || pilot.startsWith(`${orca}/`) || orca.startsWith(`${pilot}/`)) {
    throw new Error(`Pilot's data folder must be separate from Orca's (${orcaDataDir})`)
  }
}

export function formatStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

function list(values) {
  if (values.length === 0) {
    return '(none)'
  }
  return values.join(', ')
}

function printPlan({ log, orca, pilot, plan, files, stamp, pilotProfileDir }) {
  log(`Orca source:  ${orca.source} (revision ${orca.revision ?? 'n/a'})`)
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
    log(`Note: schemaVersion differs (Orca ${versions.orca}, Pilot ${versions.pilot}); Pilot's kept`)
  }
  log(`Pilot files renamed aside (suffix .${BACKUP_TAG}-${stamp}):`)
  for (const name of files) {
    log(`  - ${join(pilotProfileDir, name)}`)
  }
  log(`Then write: ${join(pilotProfileDir, DATA_FILE)}`)
}

export async function importOrcaSettings(options) {
  const log = options.log ?? console.log
  const now = options.now ?? new Date()
  const stamp = formatStamp(now)
  assertSeparateFolders(options.orcaDataDir, options.pilotDataDir)
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
  const pilotProfileDir = join(options.pilotDataDir, 'profiles', options.profileId)
  if (options.restore !== undefined) {
    const result = restoreBackup({ profileDir: pilotProfileDir, backupStamp: options.restore, stamp })
    log(`Restored: ${list(result.restored)}`)
    log(`Set aside: ${list(result.setAside)}`)
    return { status: 'restored', ...result }
  }
  const orca = readOrcaState(join(options.orcaDataDir, 'profiles', options.profileId))
  const pilot = readPilotState(pilotProfileDir)
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
  const backups = stageImport({ profileDir: pilotProfileDir, json: serializeState(plan.state), stamp })
  log(`Applied. Backups: ${list(backups)}`)
  log('Pilot imports the staged orca-data.json the next time it starts.')
  log(`To undo before or after that: --restore ${stamp}`)
  return { status: 'applied', plan, backups, stamp }
}

const HELP = `Usage: node src/packages/pilot/scripts/import-orca-settings.mjs [--dry-run | --apply | --restore <stamp>]
  Copies Orca's settings, repos, projects, worktree metadata and SSH targets into Pilot.
  Never copies Orca's automations, UI state, sessions or terminals. Quit Pilot first.
  --dry-run            print what would change (the default)
  --apply              rename Pilot's state files aside and stage the import
  --restore <stamp>    put back the files an earlier --apply renamed aside
  --profile <id>       profile in both apps (default local-default)
  --orca-data <dir>    Orca's data folder (default ~/Library/Application Support/orca)
  --pilot-data <dir>   Pilot's data folder (default ~/Library/Application Support/Pilot)`

const VALUE_FLAGS = {
  '--restore': 'restore',
  '--profile': 'profileId',
  '--orca-data': 'orcaDataDir',
  '--pilot-data': 'pilotDataDir'
}

export function parseArgs(argv) {
  const options = {
    apply: false,
    help: false,
    profileId: 'local-default',
    orcaDataDir: join(APP_SUPPORT, 'orca'),
    pilotDataDir: join(APP_SUPPORT, 'Pilot')
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') {
      options.apply = true
    } else if (arg === '--dry-run') {
      options.apply = false
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (Object.hasOwn(VALUE_FLAGS, arg) && argv[index + 1] !== undefined) {
      options[VALUE_FLAGS[arg]] = argv[index + 1]
      index += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }
  if (options.apply && options.restore !== undefined) {
    throw new Error('Use --apply or --restore, not both')
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
