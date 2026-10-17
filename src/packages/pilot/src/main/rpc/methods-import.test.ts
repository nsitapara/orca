import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { ImportStateResult } from '../../shared/api-types'
import type { SweepStateMapper } from '../importer/sweep-state/types'
import type { PilotHost } from '../pilot-services'
import { PilotStore } from '../store/store'
import {
  buildImportMethods,
  IMPORT_NO_CALLER,
  IMPORT_STATE_APPLY_ON_MAC,
  listWorktrees
} from './methods-import'

type Ctx = { caller?: RpcCallerIdentity; runtime: unknown }
type Callable = { name: string; handler(p: unknown, ctx: Ctx): Promise<unknown> }

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

  // The manual jobs keep nothing the engine needs, so importing them says so instead of failing.
  it.each([
    ['close-idle-sessions', 'M03 keeps no state: every run lists the open sessions again'],
    [
      'manual-memo',
      'M04 keeps its state in the repo (agent-loops/manual-memo), where its precheck reads it'
    ],
    ['mr-next-steps', 'M02 keeps no state: every run writes a fresh report']
  ])('%s has nothing to import', async (id, note) => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-import-state-none-'))
    const host = {
      processKind: 'main',
      dirs: [dir],
      dataDir: dir,
      error: null,
      context: { store: PilotStore.open(join(dir, 'db.sqlite')) }
    } as unknown as PilotHost
    const [method] = buildImportMethods(host, () => 7) as unknown as Callable[]
    const result = (await method.handler(
      { id },
      { caller: { kind: 'local-cli' }, runtime: { listRepos: () => [] } }
    )) as ImportStateResult
    expect([result.plan, result.handled]).toEqual([
      { automationId: id, handled: [], sessions: [], files: [], notes: [note] },
      { total: 0, present: 0, added: 0 }
    ])
  })

  it('names the known importers for an id it has none for', async () => {
    const { call } = importSetup()
    await expect(call({ id: 'nope' }, { kind: 'local-cli' })).rejects.toThrow(
      'No state importer for "nope". Known: fix-failed-ci'
    )
  })
})
