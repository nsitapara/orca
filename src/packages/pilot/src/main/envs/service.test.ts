import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { PilotStore } from '../store/store'
import { createEnvService } from './service'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

// The engine's onRunEnd: the rest of the run's end first, then the env's delete, which a failing hook never blocks.
describe('EnvService.runEnded', () => {
  it.each([
    ['an env run', true, false, ['answers', 'env delete']],
    ['an env run whose answers hook throws', true, true, ['answers', 'env delete']],
    ['a run with no env', false, false, ['answers']]
  ] as const)('%s', async (_name, withEnv, hookThrows, order) => {
    const store = PilotStore.open(':memory:')
    store.runs.create({
      id: 'r1',
      automationId: 'ci',
      tickId: null,
      itemKey: 'mr:1',
      itemLabel: '!1',
      worktreePath: '/wt/a',
      startedAt: 1
    })
    if (withEnv) {
      store.runs.envs.begin('r1', '/wt/a', {})
      store.runs.envs.settle('r1', 'failed', 'bad flags')
    }
    store.runs.update('r1', { status: 'failed', finishedAt: 2 })
    const seen: string[] = []
    const dataDir = mkdtempSync(join(tmpdir(), 'pilot-envs-'))
    dirs.push(dataDir)
    const envs = createEnvService({
      // Never reached: no folder is resolved, no tab closed, no repo rescanned (no definition).
      runtime: {} as unknown as OrcaRuntimeService,
      store,
      now: () => 1000,
      log: () => {},
      definitionFor: () => null,
      engineEnv: { binDir: '/nowhere/bin', dataDir },
      dataDir,
      terminalDraft: async () => '',
      onRunEnd: () => {
        seen.push('answers')
        if (hookThrows) {
          throw new Error('answers broke')
        }
      },
      pilotcli: async (call) => {
        seen.push(call.args.slice(0, 2).join(' '))
        return { outcome: 'ok', reason: '', data: { removed: [] }, code: 0 }
      }
    })
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
