import { describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  importOrcaSettings,
  listStateFiles,
  renameAll
  // @ts-expect-error -- .mjs script without type declarations
} from './import-orca-settings.mjs'
// @ts-expect-error -- .mjs script without type declarations
import { buildImportState } from './orca-import-policy.mjs'

type State = Record<string, unknown>

// Bun has no node:sqlite; upstream runs its SQLite tests on Node. Only the tests that read a
// database need it: the refusal tests below use plain files and run under both runtimes.
const sqlite = process.getBuiltinModule?.('node:sqlite')

const sha = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')
const asDomains = (state: State): Map<string, string> =>
  new Map(Object.entries(state).map(([key, value]) => [key, JSON.stringify(value)]))
const quiet = (): void => {}
const names = (dir: string): string[] => readdirSync(dir).sort()

// Every file's bytes (a symlink's target), to prove a folder was left exactly as it was.
function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries(
    names(dir).map((name) => {
      const path = join(dir, name)
      if (lstatSync(path).isSymbolicLink()) {
        return [name, `link:${readlinkSync(path)}`]
      }
      return [name, sha(readFileSync(path))]
    })
  )
}

// A profile-state.db in upstream's schema 3 shape (profile-state-database-schema.ts), with
// automationRuns normalized into its own table the way upstream stores it.
function writeProfileDb(dbFile: string, state: State): DatabaseSync {
  const db = new sqlite!.DatabaseSync(dbFile)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA user_version = 3')
  db.exec(`CREATE TABLE profile_state_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    CREATE TABLE profile_state_documents (domain TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL,
      domain_version INTEGER NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      content_hash TEXT NOT NULL);
    CREATE TABLE profile_state_automation_runs_meta (domain TEXT PRIMARY KEY NOT NULL,
      presence TEXT NOT NULL, domain_version INTEGER NOT NULL, revision INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, content_hash TEXT NOT NULL);
    CREATE TABLE profile_state_automation_runs (run_id TEXT PRIMARY KEY NOT NULL,
      ordinal INTEGER NOT NULL, payload TEXT NOT NULL, content_hash TEXT NOT NULL,
      revision INTEGER NOT NULL, updated_at INTEGER NOT NULL);`)
  db.prepare('INSERT INTO profile_state_meta VALUES (?, ?)').run('revision', '7')
  const document = db.prepare('INSERT INTO profile_state_documents VALUES (?, ?, 1, 7, 0, ?)')
  const { automationRuns = [], ...documents } = state
  for (const [domain, value] of Object.entries(documents)) {
    const payload = JSON.stringify(value)
    document.run(domain, payload, sha(payload))
  }
  document.run('automationRuns', 'null', sha('null'))
  const runs = (automationRuns as { id: string }[]).map((run) => JSON.stringify(run))
  const insertRun = db.prepare(
    'INSERT INTO profile_state_automation_runs VALUES (?, ?, ?, ?, 7, 0)'
  )
  runs.forEach((payload, ordinal) =>
    insertRun.run(JSON.parse(payload).id, ordinal, payload, sha(payload))
  )
  db.prepare(
    "INSERT INTO profile_state_automation_runs_meta VALUES ('automationRuns', 'array', 1, 7, 0, ?)"
  ).run(sha(`[${runs.join(',')}]`))
  return db
}

// Every domain upstream always saves, so the fixture passes the shape checks.
const ORCA_STATE: State = {
  schemaVersion: 1,
  settings: { theme: 'dark', telemetry: { installId: 'orca-install' }, machineName: 'orca' },
  repos: [{ id: 'r1' }, { id: 'r2' }],
  projects: [],
  projectHostSetups: [],
  projectGroups: [],
  folderWorkspaces: [],
  sparsePresetsByRepo: {},
  sshTargets: [],
  sshTargetGenerationCounter: 0,
  deletedSshConfigAliases: [],
  worktreeMeta: { 'r1::/w': { pinned: true } },
  worktreeLineageById: {},
  workspaceLineageByChildKey: {},
  retiredWorktreeNamesByRepo: {},
  retiredWorktreeNamesByNamespace: {},
  onboarding: { outcome: 'completed' },
  automations: [{ id: 'orca-automation' }],
  automationRuns: [{ id: 'orca-run' }],
  ui: { from: 'orca' },
  workspaceSession: { from: 'orca' }
}
const PILOT_STATE: State = {
  schemaVersion: 1,
  settings: { theme: 'light', telemetry: { installId: 'pilot-install' } },
  automations: [{ id: 'pilot-automation' }],
  automationRuns: [{ id: 'pilot-run' }],
  ui: { from: 'pilot' }
}

function folders() {
  const root = mkdtempSync(join(tmpdir(), 'pilot-orca-import-test-'))
  const orcaData = join(root, 'orca')
  const pilotData = join(root, 'Pilot')
  const orcaProfile = join(orcaData, 'profiles', 'local-default')
  const pilotProfile = join(pilotData, 'profiles', 'local-default')
  mkdirSync(orcaProfile, { recursive: true })
  mkdirSync(pilotProfile, { recursive: true })
  writeFileSync(join(pilotProfile, 'active-view.json'), '{}')
  return { root, orcaData, orcaProfile, pilotData, pilotProfile }
}

// Orca with its database open in WAL mode, as while it runs; Pilot quit, with the evidence
// files that would block a JSON import.
function fixture() {
  const f = folders()
  // Held open for the whole test: closing would checkpoint and remove the WAL.
  const orcaDb = writeProfileDb(join(f.orcaProfile, 'profile-state.db'), ORCA_STATE)
  writeProfileDb(join(f.pilotProfile, 'profile-state.db'), PILOT_STATE).close()
  writeFileSync(join(f.pilotProfile, 'profile-state.db.authority'), 'sqlite\n')
  writeFileSync(
    join(f.pilotProfile, 'profile-state.db.backup.1-c476a8e9-d82c-42ef-8a06-644e52de620a.db'),
    ''
  )
  writeFileSync(join(f.pilotProfile, 'orca-data.json.sqlite-export.3.json'), '{}')
  return { ...f, orcaDb }
}

// Plain files only: nothing here needs a database, so these run under Bun too.
function plainFixture() {
  const f = folders()
  writeFileSync(join(f.orcaProfile, 'profile-state.db'), 'orca bytes')
  writeFileSync(join(f.pilotProfile, 'profile-state.db'), 'pilot bytes')
  writeFileSync(join(f.pilotProfile, 'profile-state.db.authority'), 'sqlite\n')
  writeFileSync(join(f.pilotProfile, 'orca-data.json.pre-orca-import-20261010T120000Z'), '{}')
  return f
}

const options = (f: { orcaData: string; pilotData: string }, extra: State = {}): State => ({
  orcaDataDir: f.orcaData,
  pilotDataDir: f.pilotData,
  profileId: 'local-default',
  listProcesses: () => ['/Applications/Orca.app/Contents/MacOS/Orca'],
  log: quiet,
  ...extra
})

describe('buildImportState', () => {
  // Only a string: buildImportState never touches the filesystem.
  const orcaData = join(homedir(), 'not-a-real-orca-data-folder')
  const orca = asDomains({
    ...ORCA_STATE,
    settings: {
      theme: 'dark',
      telemetry: { installId: 'orca-install' },
      machineName: 'orca-mac',
      httpProxyUrl: 'sealed-by-orca',
      claudeManagedAccounts: [{ managedAuthPath: '/elsewhere' }],
      voice: { modelsDir: `${orcaData}/speech-models` },
      notifications: { customSoundPath: '~/not-a-real-orca-data-folder/ding.wav' }
    },
    claudeLivePtySessionIds: ['pty-1']
  })
  const pilot = asDomains({
    ...PILOT_STATE,
    settings: { theme: 'light', telemetry: { installId: 'pilot-install' }, pilotOnly: true },
    folderWorkspaceDiffComments: { stale: [] }
  })
  const plan = buildImportState({ orca, pilot, orcaDataDir: orcaData })
  const domain = (name: string): unknown => {
    const payload = plan.state.get(name)
    return payload === undefined ? undefined : JSON.parse(payload)
  }

  it.each([
    ['repos', ORCA_STATE.repos],
    ['worktreeMeta', ORCA_STATE.worktreeMeta],
    ['automations', PILOT_STATE.automations],
    ['automationRuns', PILOT_STATE.automationRuns],
    ['ui', PILOT_STATE.ui],
    ['workspaceSession', undefined],
    ['claudeLivePtySessionIds', undefined],
    ['folderWorkspaceDiffComments', undefined]
  ])('%s comes from Orca only when whitelisted', (name, expected) => {
    expect(domain(name)).toEqual(expected)
  })

  it.each([
    ['theme', 'dark'],
    ['pilotOnly', true],
    ['telemetry', { installId: 'pilot-install' }],
    ['machineName', undefined],
    ['httpProxyUrl', undefined],
    ['claudeManagedAccounts', undefined],
    ['voice', undefined],
    ['notifications', undefined]
  ])('settings.%s', (key, expected) => {
    expect((domain('settings') as State)[key]).toEqual(expected)
  })

  it('names every excluded setting and where its value comes from', () => {
    expect(plan.settingsExcluded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'telemetry', kept: "Pilot's current value" }),
        expect.objectContaining({ key: 'machineName', kept: "Pilot's default" }),
        expect.objectContaining({ key: 'voice', reason: "a value points into Orca's data folder" }),
        expect.objectContaining({ key: 'notifications' })
      ])
    )
    expect(plan.counts.orcaAutomationsSkipped).toBe(1)
  })
})

describe('importOrcaSettings without a database', () => {
  const pilotProcess = ['/x/dist/mac-arm64/Pilot.app/Contents/MacOS/Pilot']

  it.each([
    ['apply', 'a Pilot process', pilotProcess, undefined],
    ['apply', 'a stale SingletonLock symlink', [], 'SingletonLock'],
    ['apply', 'orcad.lock', [], 'orcad.lock'],
    ['restore', 'a Pilot process', pilotProcess, undefined],
    ['restore', 'a stale SingletonLock symlink', [], 'SingletonLock'],
    ['restore', 'orcad.lock', [], 'orcad.lock']
  ])(
    'refuses %s while %s says Pilot runs, and changes nothing',
    async (mode, _, processes, lock) => {
      const f = plainFixture()
      if (lock === 'SingletonLock') {
        // Electron's lock is a symlink to "<host>-<pid>", which never resolves.
        symlinkSync('Mac-1427', join(f.pilotData, lock))
      } else if (lock !== undefined) {
        writeFileSync(join(f.pilotData, lock), '')
      }
      const modeOption = mode === 'apply' ? { apply: true } : { restore: '20261010T120000Z' }
      const [orcaBefore, pilotBefore] = [snapshot(f.orcaProfile), snapshot(f.pilotProfile)]
      const result = await importOrcaSettings(
        options(f, { ...modeOption, listProcesses: () => processes })
      )
      expect(result.status).toBe('refused')
      expect([snapshot(f.orcaProfile), snapshot(f.pilotProfile)]).toEqual([orcaBefore, pilotBefore])
    }
  )

  it('refuses a --pilot-data symlink that leads into the Orca folder', async () => {
    const f = plainFixture()
    const inside = join(f.orcaData, 'pilot-inside-orca')
    mkdirSync(inside)
    const link = join(f.root, 'PilotLink')
    symlinkSync(inside, link)
    const before = snapshot(f.orcaProfile)
    await expect(importOrcaSettings(options({ ...f, pilotData: link }))).rejects.toThrow(
      /separate from Orca/
    )
    expect(snapshot(f.orcaProfile)).toEqual(before)
  })

  it('renameAll undoes the renames it made when a later one fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-rename-all-'))
    for (const name of ['a', 'b', 'c']) {
      writeFileSync(join(dir, name), name)
    }
    const pairs = ['a', 'b', 'c'].map((name) => [join(dir, name), join(dir, `${name}.moved`)])
    const failOnC = (from: string, to: string): void => {
      if (from === join(dir, 'c')) {
        throw new Error('disk said no')
      }
      renameSync(from, to)
    }
    expect(() => renameAll(pairs, failOnC)).toThrow('disk said no')
    expect(snapshot(dir)).toEqual({ a: sha('a'), b: sha('b'), c: sha('c') })
  })

  it('--list names each backup set, even while Pilot runs', async () => {
    const f = plainFixture()
    writeFileSync(join(f.pilotProfile, 'profile-state.db.pre-orca-import-20261011T090000Z'), '')
    const result = await importOrcaSettings(
      options(f, { list: true, listProcesses: () => pilotProcess })
    )
    expect(result.status).toBe('listed')
    expect(result.backups.map((set: { stamp: string }) => set.stamp)).toEqual([
      '20261010T120000Z',
      '20261011T090000Z'
    ])
  })
})

describe.skipIf(sqlite === undefined)('importOrcaSettings with node:sqlite', () => {
  it('dry run reads both apps and changes no files in either', async () => {
    const f = fixture()
    const [orcaBefore, pilotBefore] = [snapshot(f.orcaProfile), snapshot(f.pilotProfile)]
    expect(Object.keys(orcaBefore)).toContain('profile-state.db-wal')
    const result = await importOrcaSettings(options(f))
    expect(result.status).toBe('dry-run')
    expect(result.plan.counts.repos).toBe(2)
    expect([snapshot(f.orcaProfile), snapshot(f.pilotProfile)]).toEqual([orcaBefore, pilotBefore])
    f.orcaDb.close()
  })

  it('apply stages the import, backs up what it replaces, and re-runs cleanly', async () => {
    const f = fixture()
    const orcaBefore = snapshot(f.orcaProfile)
    const replaced = listStateFiles(f.pilotProfile)
    const first = await importOrcaSettings(
      options(f, { apply: true, now: new Date('2026-10-10T12:00:00Z') })
    )
    expect(listStateFiles(f.pilotProfile)).toEqual(['orca-data.json'])
    expect(first.backups.map((path: string) => basename(path))).toEqual(
      replaced.map((name: string) => `${name}.pre-orca-import-20261010T120000Z`)
    )
    const staged = JSON.parse(readFileSync(join(f.pilotProfile, 'orca-data.json'), 'utf8'))
    expect(staged).toMatchObject({
      repos: ORCA_STATE.repos,
      automations: PILOT_STATE.automations,
      automationRuns: PILOT_STATE.automationRuns,
      ui: PILOT_STATE.ui,
      settings: { theme: 'dark', telemetry: { installId: 'pilot-install' } }
    })
    expect(staged.settings).not.toHaveProperty('machineName')

    const again = await importOrcaSettings(
      options(f, { apply: true, now: new Date('2026-10-10T12:05:00Z') })
    )
    expect(again.status).toBe('applied')
    expect(JSON.parse(readFileSync(join(f.pilotProfile, 'orca-data.json'), 'utf8'))).toEqual(staged)
    // Not even the live -shm: Orca's files are copied, never opened.
    expect(snapshot(f.orcaProfile)).toEqual(orcaBefore)
    f.orcaDb.close()
  })

  it('restore puts the renamed files back and sets the staged import aside', async () => {
    const f = fixture()
    const before = listStateFiles(f.pilotProfile)
    const applied = await importOrcaSettings(options(f, { apply: true }))
    const restored = await importOrcaSettings(options(f, { restore: applied.stamp }))
    expect(restored.status).toBe('restored')
    expect(listStateFiles(f.pilotProfile)).toEqual(before)
    expect(restored.setAside).toHaveLength(1)
    f.orcaDb.close()
  })

  it.each([
    ['an unknown schema', 'orca', 'PRAGMA user_version = 4', /schema 4/],
    [
      'an unknown domain_version',
      'orca',
      "UPDATE profile_state_documents SET domain_version = 2 WHERE domain = 'repos'",
      /Orca's repos has domain_version 2/
    ],
    [
      'a null placeholder',
      'orca',
      `UPDATE profile_state_documents SET payload = 'null', content_hash = '${sha('null')}'
       WHERE domain = 'repos'`,
      /Orca's repos is null, expected array/
    ],
    [
      'the wrong JSON type',
      'orca',
      `UPDATE profile_state_documents SET payload = '{}', content_hash = '${sha('{}')}'
       WHERE domain = 'repos'`,
      /Orca's repos is object, expected array/
    ],
    [
      'a missing domain',
      'orca',
      "DELETE FROM profile_state_documents WHERE domain = 'repos'",
      /Orca has no repos/
    ],
    [
      "an unknown domain_version on Pilot's own domain",
      'pilot',
      "UPDATE profile_state_documents SET domain_version = 2 WHERE domain = 'ui'",
      /Pilot's ui has domain_version 2/
    ]
  ])('refuses %s and changes nothing', async (_, app, sql, error) => {
    const f = fixture()
    if (app === 'orca') {
      f.orcaDb.exec(sql)
    } else {
      const pilotDb = new sqlite!.DatabaseSync(join(f.pilotProfile, 'profile-state.db'))
      pilotDb.exec(sql)
      pilotDb.close()
    }
    const pilotBefore = snapshot(f.pilotProfile)
    await expect(importOrcaSettings(options(f, { apply: true }))).rejects.toThrow(error)
    expect(snapshot(f.pilotProfile)).toEqual(pilotBefore)
    f.orcaDb.close()
  })
})
