import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import { loadDefinitions } from '../definitions/loader'
import { PilotStore } from '../store/store'
import { LogReader } from '../transcript/log-file'
import { RunEffectsReader } from '../transcript/run-effects'
import { buildVisibilityMethods, LOG_BY_PERSON } from './methods-visibility'

type Callable = { name: string; handler(p: unknown, rpc: { caller?: RpcCallerIdentity }): unknown }

function setup() {
  const store = PilotStore.open(':memory:')
  const root = mkdtempSync(join(tmpdir(), 'pilot-rpc-log-'))
  const loaded = loadDefinitions([])
  const ctx = {
    processKind: 'main' as const,
    store,
    dirs: [],
    loaded: () => loaded,
    reload: () => loaded,
    scheduler: { nextTickAt: () => null } as never,
    actions: { entries: () => [], get: () => null } as never,
    dispatcher: null,
    schedulerOn: true
  }
  const log = { store, reader: new LogReader(root), claudeProjects: root }
  const readers = { log, effects: new RunEffectsReader({ ...log, remoteOf: async () => null }) }
  store.runs.create({
    id: 'r1',
    automationId: 'a',
    tickId: null,
    itemKey: 'k',
    itemLabel: 'k',
    worktreePath: null,
    startedAt: 1
  })
  store.runs.createStep({
    runId: 'r1',
    idx: 0,
    name: 's',
    agent: 'shell',
    skill: null,
    startedAt: 1,
    kind: 'shell'
  })
  const methods = buildVisibilityMethods(
    () => ctx as never,
    () => readers
  ) as unknown as Callable[]
  return (name: string) => methods.find((m) => m.name === name)!
}

describe('visibility methods', () => {
  it.each([
    ['pilot.runs.log', { runId: 'r1', stepIdx: 0 }],
    ['pilot.runs.logEntry', { runId: 'r1', stepIdx: 0, id: 'x' }]
  ])('%s refuses the local CLI and an unnamed caller', async (name, params) => {
    const find = setup()
    await expect(async () =>
      find(name).handler(params, { caller: { kind: 'local-cli' } })
    ).rejects.toThrow(LOG_BY_PERSON)
    await expect(async () => find(name).handler(params, {})).rejects.toThrow(LOG_BY_PERSON)
  })

  it.each<RpcCallerIdentity>([{ kind: 'desktop' }, { kind: 'paired-device', deviceId: 'ipad' }])(
    'pilot.runs.log answers the desktop and a paired device (%o)',
    async (caller) => {
      const find = setup()
      expect(
        await find('pilot.runs.log').handler({ runId: 'r1', stepIdx: 0 }, { caller })
      ).toMatchObject({ source: 'none' })
    }
  )

  it('pilot.runs.effects answers any caller with effects by run id', async () => {
    const find = setup()
    expect(
      await find('pilot.runs.effects').handler(
        { runIds: ['r1'] },
        { caller: { kind: 'local-cli' } }
      )
    ).toEqual({ r1: [] })
  })

  it('pilot.runs.acknowledge refuses the local CLI', async () => {
    const find = setup()
    await expect(async () =>
      find('pilot.runs.acknowledge').handler({ runIds: ['r1'] }, { caller: { kind: 'local-cli' } })
    ).rejects.toThrow(LOG_BY_PERSON)
  })
})
