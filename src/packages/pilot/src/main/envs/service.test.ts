import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { PilotStore } from '../store/store'
import type { PilotcliReply } from './pilotcli'
import { RECOVERED_OUTCOME } from './recover'
import { createEnvService, OWNED_SWEEP_EVERY_MS } from './service'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function storeWithRun(status: 'running' | 'failed') {
  const store = PilotStore.open(':memory:')
  store.runs.create({
    id: 'r1',
    automationId: 'ci',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1',
    worktreePath: '/wt/a',
    startedAt: 1,
    status
  })
  return store
}

// `seen` records the answers hook and each pilotcli call (its first two words).
function serviceFor(
  store: PilotStore,
  seen: string[],
  opts: { hookThrows?: boolean; now?: () => number } = {}
) {
  const dataDir = mkdtempSync(join(tmpdir(), 'pilot-envs-'))
  dirs.push(dataDir)
  return createEnvService({
    // Never reached: no folder is resolved, no tab closed, no repo rescanned (no definition).
    runtime: {} as unknown as OrcaRuntimeService,
    store,
    now: opts.now ?? (() => 1000),
    log: () => {},
    definitionFor: () => null,
    engineEnv: { binDir: '/nowhere/bin', dataDir },
    dataDir,
    terminalDraft: async () => '',
    onRunEnd: () => {
      seen.push('answers')
      if (opts.hookThrows) {
        throw new Error('answers broke')
      }
    },
    pilotcli: async (call): Promise<PilotcliReply> => {
      seen.push(call.args.slice(0, 2).join(' '))
      const data = call.args[1] === 'list' ? [] : { removed: [] }
      return { outcome: 'ok', reason: '', data, code: 0 }
    }
  })
}

// The engine's onRunEnd: the rest of the run's end first, then the env's delete, which a failing hook never blocks.
describe('EnvService.runEnded', () => {
  it.each([
    ['an env run', true, false, ['answers', 'env delete']],
    ['an env run whose answers hook throws', true, true, ['answers', 'env delete']],
    ['a run with no env', false, false, ['answers']]
  ] as const)('%s', async (_name, withEnv, hookThrows, order) => {
    const store = storeWithRun('failed')
    if (withEnv) {
      store.runs.envs.begin('r1', '/wt/a', {})
      store.runs.envs.settle('r1', 'failed', 'bad flags')
    }
    store.runs.update('r1', { status: 'failed', finishedAt: 2 })
    const seen: string[] = []
    const envs = serviceFor(store, seen, { hookThrows })
    const ended = () => envs.runEnded(store.runs.get('r1')!)
    if (hookThrows) {
      expect(ended).toThrow('answers broke')
    } else {
      ended()
    }
    if (withEnv) {
      await vi.waitFor(() => expect(store.runs.get('r1')?.env?.removedAt).toBe(1000))
    }
    expect(seen).toEqual(order)
  })
})

// M4 §8, Pilot starts: a run a stopped Pilot left preparing closes through the run end (its answers hook, then its env's
// delete), then the sweep lists what pilotcli has.
describe('EnvService.startup', () => {
  it('closes a run left preparing like any run end, then sweeps', async () => {
    const store = storeWithRun('running')
    store.markHandled('ci', '1', 'r1', 1)
    // This process's own pid, recorded by an earlier one: at start it reads as gone (writerGone).
    store.runs.envs.begin('r1', '/wt/a', { preparer: { pid: process.pid, identity: null } })
    const seen: string[] = []
    await serviceFor(store, seen).startup()
    await vi.waitFor(() => expect(store.runs.get('r1')?.env?.removedAt).toBe(1000))
    expect(store.runs.get('r1')).toMatchObject({ status: 'failed', outcome: RECOVERED_OUTCOME })
    expect(store.handledRows('ci')).toEqual([])
    expect(seen[0]).toBe('answers')
    expect([...seen].sort()).toEqual(['answers', 'env delete', 'env list'])
  })
})

// The scheduler's poll: an env list for the owned-env sweep at most every OWNED_SWEEP_EVERY_MS.
describe('EnvService.housekeep', () => {
  it('sweeps the envs ended runs own at most every OWNED_SWEEP_EVERY_MS', async () => {
    let at = 1000
    const seen: string[] = []
    const envs = serviceFor(storeWithRun('failed'), seen, { now: () => at })
    envs.housekeep()
    await vi.waitFor(() => expect(seen).toEqual(['env list']))
    at += OWNED_SWEEP_EVERY_MS - 1
    envs.housekeep()
    await new Promise((resolve) => setImmediate(resolve))
    expect(seen).toEqual(['env list'])
    at += 1
    envs.housekeep()
    await vi.waitFor(() => expect(seen).toEqual(['env list', 'env list']))
  })
})
