import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { ImportStateResult } from '../../shared/api-types'
import { loadDefinitions } from '../definitions/loader'
import type { SweepStateMapper } from '../importer/sweep-state/types'
import type { VaultRow } from '../inbox/vault-reader'
import type { PilotHost } from '../pilot-services'
import { PilotStore } from '../store/store'
import { buildPilotMethods } from './methods'
import { IMPORT_APPLY_DESKTOP, IMPORT_NO_CALLER } from './methods-answers'
import { buildImportMethods, IMPORT_STATE_APPLY_ON_MAC, listWorktrees } from './methods-import'

const read = vi.hoisted(() => vi.fn())
vi.mock('../inbox/vault-reader', () => ({ readOpenVaultItems: read }))

type Ctx = { caller?: RpcCallerIdentity; runtime: unknown }
type Callable = { name: string; handler(p: unknown, ctx: Ctx): Promise<unknown> }

const CI =
  'name: Fix failed CI on my MRs\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: nish\n'
const ROW = {
  note: '/v/n.md',
  key: 'k1',
  kind: 'question',
  family: 'question',
  summary: 'Which?',
  location: '',
  context: '',
  suggested: '',
  options: [],
  run_command: '',
  parts: [],
  switch: [],
  details: '',
  details_path: '',
  digest: 'd',
  answer: '',
  replies: [],
  status: 'waiting',
  resume: '',
  session: '',
  asked_in: '',
  section_time: '',
  created_at: null,
  worktree: null,
  mr_iid: 7,
  job: '05 · Fix failed CI on my MRs',
  job_code: '05',
  skill: 's',
  scope: 'branch',
  branch: 'b',
  bound: false
} as VaultRow

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-import-rpc-'))
  writeFileSync(join(dir, 'people.yaml'), 'people:\n  - { id: nish, name: Nish }\n')
  writeFileSync(join(dir, 'fix-failed-ci.yaml'), CI)
  const loaded = loadDefinitions([dir])
  const store = PilotStore.open(join(dir, 'db.sqlite'))
  store.runs.create({
    id: 'run-1',
    automationId: 'fix-failed-ci',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1',
    worktreePath: '/wt',
    startedAt: 1
  })
  store.runs.createStep({
    runId: 'run-1',
    idx: 0,
    name: 's',
    agent: 'claude',
    skill: null,
    startedAt: 1
  })
  const actions = { entries: () => [], get: () => null }
  const host: PilotHost = {
    processKind: 'main',
    dirs: [dir],
    dataDir: dir,
    error: null,
    context: {
      processKind: 'main',
      store,
      dirs: [dir],
      loaded: () => loaded,
      reload: () => loaded,
      scheduler: null as never,
      actions,
      dispatcher: null
    }
  }
  const method = (buildPilotMethods(host) as unknown as Callable[]).find(
    (m) => m.name === 'pilot.inbox.importVault'
  )!
  const call = (p: unknown, caller: RpcCallerIdentity | null = { kind: 'desktop' }) =>
    method.handler(p, { caller: caller ?? undefined, runtime: { listRepos: () => [] } })
  return { store, call }
}

describe('pilot.inbox.importVault', () => {
  it('needs a caller identity', async () => {
    const { call, store } = setup()
    read.mockResolvedValue([ROW])
    await expect(call({ apply: true }, null)).rejects.toThrow(IMPORT_NO_CALLER)
    expect(store.inbox.list({ source: 'import' })).toEqual([])
  })

  it.each<RpcCallerIdentity>([{ kind: 'local-cli' }, { kind: 'paired-device', deviceId: 'd1' }])(
    'applies for no %j caller, and writes nothing',
    async (caller) => {
      const { call, store } = setup()
      read.mockResolvedValue([ROW])
      await expect(call({ apply: true }, caller)).rejects.toThrow(IMPORT_APPLY_DESKTOP)
      expect(store.inbox.list({ source: 'import' })).toEqual([])
    }
  )

  it.each<RpcCallerIdentity>([
    { kind: 'local-cli' },
    { kind: 'paired-device', deviceId: 'd1' },
    { kind: 'desktop' }
  ])('previews for a %j caller', async (caller) => {
    const { call } = setup()
    read.mockResolvedValue([ROW])
    expect(await call({ apply: false }, caller)).toMatchObject({ applied: false, imported: 1 })
  })

  it('reports on a dry run, imports on --apply, and imports nothing the second time', async () => {
    const { call, store } = setup()
    read.mockResolvedValue([ROW])
    expect(await call({ apply: false })).toMatchObject({ applied: false, imported: 1 })
    expect(store.inbox.list({ source: 'import' })).toEqual([])
    expect(await call({ apply: true })).toMatchObject({ applied: true, imported: 1 })
    expect(await call({ apply: true })).toMatchObject({
      applied: true,
      imported: 0,
      skipped: [{ reason: 'already imported' }]
    })
    expect(store.inbox.list({ source: 'import' })).toHaveLength(1)
  })
})

describe('listWorktrees', () => {
  it("lists every repo's managed worktrees, with the branch's short name or null", async () => {
    const runtime = {
      listRepos: () => [{ id: 'r1' }, { id: 'r2' }],
      listManagedWorktrees: async (selector: string) => ({
        worktrees:
          selector === 'id:r1'
            ? [{ id: 'r1::/wt/a', git: { path: '/wt/a', branch: 'refs/heads/web-1-a' } }]
            : [{ id: 'r2::/wt/b', git: { path: '/wt/b', branch: '' } }]
      })
    } as unknown as OrcaRuntimeService
    expect(await listWorktrees(runtime)).toEqual([
      { id: 'r1::/wt/a', path: '/wt/a', branch: 'web-1-a' },
      { id: 'r2::/wt/b', path: '/wt/b', branch: null }
    ])
  })

  it('refuses a cut-short list, so no mapper matches old tabs against part of the worktrees', async () => {
    const runtime = {
      listRepos: () => [{ id: 'r1', path: '/repo' }],
      listManagedWorktrees: async () => ({ worktrees: [], truncated: true, totalCount: 900 })
    } as unknown as OrcaRuntimeService
    await expect(listWorktrees(runtime)).rejects.toThrow('cut short (900 worktrees)')
  })
})

describe('pilot.automations.importState', () => {
  // A mapper that reads nothing and brings one handled key.
  const MAPPER: SweepStateMapper = {
    automationId: 'fix-failed-ci',
    plan: () => ({
      automationId: 'fix-failed-ci',
      handled: [{ onceKey: 'k1', status: 'done' }],
      sessions: [],
      files: [],
      notes: []
    })
  }

  function importSetup() {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-import-state-rpc-'))
    const store = PilotStore.open(join(dir, 'db.sqlite'))
    const host = {
      processKind: 'main',
      dirs: [dir],
      dataDir: dir,
      error: null,
      context: { store }
    } as unknown as PilotHost
    const [method] = buildImportMethods(host, () => 7, [MAPPER]) as unknown as Callable[]
    const call = (p: unknown, caller: RpcCallerIdentity | null) =>
      method.handler(p, {
        caller: caller ?? undefined,
        runtime: { listRepos: () => [] }
      }) as Promise<ImportStateResult>
    return { store, call }
  }

  it('needs a caller identity, and writes nothing', async () => {
    const { call, store } = importSetup()
    await expect(call({ id: 'fix-failed-ci', apply: true }, null)).rejects.toThrow(IMPORT_NO_CALLER)
    expect(store.handledKeys('fix-failed-ci')).toEqual(new Set())
  })

  it.each<RpcCallerIdentity>([
    { kind: 'local-cli' },
    { kind: 'paired-device', deviceId: 'd1' },
    { kind: 'desktop' }
  ])('previews for a %j caller', async (caller) => {
    const { call, store } = importSetup()
    expect(await call({ id: 'fix-failed-ci' }, caller)).toMatchObject({
      apply: false,
      handled: { total: 1, present: 0, added: 0 }
    })
    expect(store.handledKeys('fix-failed-ci')).toEqual(new Set())
  })

  // It only adds Pilot's own bookkeeping rows from the old sweeps' files on this Mac: nothing starts or is sent.
  it.each<RpcCallerIdentity>([{ kind: 'local-cli' }, { kind: 'desktop' }])(
    'applies for a %j caller',
    async (caller) => {
      const { call, store } = importSetup()
      expect(await call({ id: 'fix-failed-ci', apply: true }, caller)).toMatchObject({
        apply: true,
        handled: { total: 1, present: 0, added: 1 }
      })
      expect(store.handledKeys('fix-failed-ci')).toEqual(new Set(['k1']))
    }
  )

  it('applies for no paired device, and writes nothing', async () => {
    const { call, store } = importSetup()
    await expect(
      call({ id: 'fix-failed-ci', apply: true }, { kind: 'paired-device', deviceId: 'd1' })
    ).rejects.toThrow(IMPORT_STATE_APPLY_ON_MAC)
    expect(store.handledKeys('fix-failed-ci')).toEqual(new Set())
  })

  it('names the known importers for an id it has none for', async () => {
    const { call } = importSetup()
    await expect(call({ id: 'nope' }, { kind: 'local-cli' })).rejects.toThrow(
      'No state importer for "nope". Known: fix-failed-ci'
    )
  })
})
