import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import { loadDefinitions } from '../definitions/loader'
import type { VaultRow } from '../inbox/vault-reader'
import type { PilotHost } from '../pilot-services'
import { PilotStore } from '../store/store'
import { buildPilotMethods } from './methods'
import { IMPORT_APPLY_DESKTOP, IMPORT_NO_CALLER } from './methods-answers'

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
