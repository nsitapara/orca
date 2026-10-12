// What the Orca -> Pilot settings import copies, what it never copies, and when it refuses.
// Pure: no files are written here. import-orca-settings.mjs does the staging.
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { isRecord } from './orca-profile-reader.mjs'

// Copied from Orca, with each domain's JSON shape (PersistedState in
// src/shared/persisted-state-types.ts). Each one replaces Pilot's value.
export const IMPORTED_DOMAIN_JSON_TYPES = {
  settings: 'object',
  repos: 'array',
  projects: 'array',
  projectHostSetups: 'array',
  projectGroups: 'array',
  folderWorkspaces: 'array',
  // Stored beside folderWorkspaces: their diff comments are split out on save.
  folderWorkspaceDiffComments: 'object',
  sparsePresetsByRepo: 'object',
  sshTargets: 'array',
  sshTargetGenerationCounter: 'number',
  deletedSshConfigAliases: 'array',
  worktreeMeta: 'object',
  worktreeMetaByIdentity: 'object',
  worktreeIdentityAliases: 'object',
  worktreeLineageById: 'object',
  workspaceLineageByChildKey: 'object',
  retiredWorktreeNamesByRepo: 'object',
  retiredWorktreeNamesByNamespace: 'object',
  onboarding: 'object'
}
export const IMPORTED_DOMAINS = Object.keys(IMPORTED_DOMAIN_JSON_TYPES)

// Optional in PersistedState and only saved when set. Every other imported domain is in
// getDefaultPersistedState (src/shared/constants.ts), so upstream always saves it.
const OPTIONAL_DOMAINS = [
  'folderWorkspaceDiffComments',
  'worktreeMetaByIdentity',
  'worktreeIdentityAliases'
]

// PROFILE_STATE_DOCUMENT_VERSION (profile-state-database-schema.ts), stored per row as
// domain_version.
export const SUPPORTED_DOMAIN_VERSION = 1

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

// The folder's spellings: as given and, when it exists, with symlinks resolved.
export function folderSpellings(folder) {
  const given = resolve(folder)
  if (!existsSync(given)) {
    return [given]
  }
  const real = realpathSync(given)
  if (real === given) {
    return [given]
  }
  return [given, real]
}

// Lower-cased needles for Orca's data folder: each spelling, absolute and ~-relative.
function folderNeedles(folder) {
  const needles = []
  for (const spelling of folderSpellings(folder)) {
    needles.push(spelling.toLowerCase())
    if (spelling.startsWith(`${homedir()}/`)) {
      needles.push(`~${spelling.slice(homedir().length)}`.toLowerCase())
    }
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

// Orca's settings win, except the excluded ones, which keep Pilot's value (or its default).
export function mergeSettings(orcaSettings, pilotSettings, orcaDataDir) {
  const needles = folderNeedles(orcaDataDir)
  const settings = { ...pilotSettings }
  const excluded = []
  for (const [key, value] of Object.entries(orcaSettings)) {
    let reason = EXCLUDED_SETTINGS[key]
    if (reason === undefined && pointsInto(value, needles)) {
      reason = ORCA_FOLDER_REASON
    }
    if (reason === undefined) {
      settings[key] = value
      continue
    }
    const kept = Object.hasOwn(pilotSettings, key) ? "Pilot's current value" : "Pilot's default"
    excluded.push({ key, reason, kept })
  }
  return { settings, excluded }
}

function jsonTypeOf(value) {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  return typeof value
}

function assertDomainVersions(app, versions, domains) {
  for (const domain of domains) {
    const version = versions.get(domain)
    if (version !== undefined && version !== SUPPORTED_DOMAIN_VERSION) {
      throw new Error(
        `${app}'s ${domain} has domain_version ${version}; this script knows ` +
          `${SUPPORTED_DOMAIN_VERSION}. Update the script before importing.`
      )
    }
  }
}

// Refuse rather than import a shape this script was not written for: an unknown domain_version,
// or a whitelisted Orca domain that is missing, null (what upstream leaves when it moves a domain
// into a side table) or the wrong JSON type. Pilot's own domains are carried over too, so their
// versions are checked as well.
export function assertImportable(orca, pilot) {
  assertDomainVersions('Orca', orca.versions, IMPORTED_DOMAINS)
  assertDomainVersions('Pilot', pilot.versions, [...pilot.domains.keys()])
  for (const [domain, expected] of Object.entries(IMPORTED_DOMAIN_JSON_TYPES)) {
    const payload = orca.domains.get(domain)
    if (payload === undefined) {
      if (OPTIONAL_DOMAINS.includes(domain)) {
        continue
      }
      throw new Error(`Orca has no ${domain}; upstream may have moved it. Update the script.`)
    }
    const actual = jsonTypeOf(JSON.parse(payload))
    if (actual !== expected) {
      throw new Error(
        `Orca's ${domain} is ${actual}, expected ${expected}; upstream may store it ` +
          'elsewhere now. Update the script before importing.'
      )
    }
  }
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
