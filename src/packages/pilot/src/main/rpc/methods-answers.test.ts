import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { AnswerDispatcher } from '../answers/dispatcher'
import { loadDefinitions } from '../definitions/loader'
import type { PilotHost } from '../pilot-services'
import { PilotStore } from '../store/store'
import { buildPilotMethods } from './methods'

type Callable = {
  name: string
  params: { safeParse(v: unknown): { success: boolean } } | null
  handler(p: unknown, ctx: { caller?: RpcCallerIdentity }): unknown
}
const REPORT = { retired: 0, ticked: 1, actions: 0, agents: 0, held: 0, reasked: 0 }

function setup(withDispatcher = true) {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-answers-rpc-'))
  const loaded = loadDefinitions([dir])
  const applyNow = vi.fn(async () => REPORT)
  const host: PilotHost = {
    processKind: 'main',
    dirs: [dir],
    dataDir: dir,
    error: null,
    context: {
      processKind: 'main',
      store: PilotStore.open(join(dir, 'db.sqlite')),
      dirs: [dir],
      loaded: () => loaded,
      reload: () => loaded,
      scheduler: null as never,
      actions: { entries: () => [], get: () => null },
      dispatcher: withDispatcher ? ({ applyNow } as unknown as AnswerDispatcher) : null,
      schedulerOn: withDispatcher
    }
  }
  writeFileSync(join(dir, 'people.yaml'), 'people:\n  - { id: nish, name: Nish }\n')
  const method = (buildPilotMethods(host) as unknown as Callable[]).find(
    (m) => m.name === 'pilot.answers.applyNow'
  )!
  return { method, applyNow }
}

describe('pilot.answers.applyNow', () => {
  it.each([
    [{}, true],
    [{ ids: ['in_1'] }, true],
    [{ ids: [] }, true],
    [{ ids: [''] }, false],
    [{ ids: 'in_1' }, false],
    [{ approver: true }, true]
  ])('checks params %j', (params, ok) => {
    expect(setup().method.params!.safeParse(params).success).toBe(ok)
  })

  // Only the transport's stamp can say a person on this Mac pressed it: params never can.
  it.each<[string, RpcCallerIdentity, boolean]>([
    ["Pilot's desktop app", { kind: 'desktop' }, true],
    ['a paired device', { kind: 'paired-device', deviceId: 'ipad' }, false],
    ['the local CLI (an agent, or a terminal)', { kind: 'local-cli' }, false]
  ])(
    'settles for %s, letting it hurry approvals only from the desktop',
    async (_name, caller, approver) => {
      const { method, applyNow } = setup()
      expect(await method.handler({ ids: ['in_1'], approver: true }, { caller })).toEqual(REPORT)
      expect(applyNow).toHaveBeenCalledWith({ ids: ['in_1'], approver })
    }
  )

  it("refuses a caller the transport didn't name, settling nothing", async () => {
    const { method, applyNow } = setup()
    await expect(method.handler({}, {})).rejects.toThrow("Pilot can't tell who is calling")
    expect(applyNow).not.toHaveBeenCalled()
  })

  it("says so in a process that doesn't run the scheduler", async () => {
    const { method } = setup(false)
    await expect(method.handler({}, { caller: { kind: 'desktop' } })).rejects.toThrow(
      'Answers are applied by the Pilot app that runs the scheduler'
    )
  })
})
