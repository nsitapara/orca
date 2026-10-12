import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { PilotStatus } from '../../shared/api-types'
import { loadDefinitions } from '../definitions/loader'
import type { PilotHost } from '../pilot-services'
import { PilotStore } from '../store/store'
import { buildPilotMethods } from './methods'

// Desktop/serve Pilot inside Electron: Orca's own engine is off there.
vi.mock('../orca-automations-off', () => ({ isOrcaAutomationsOff: () => true }))

type Callable = {
  name: string
  params: { safeParse(v: unknown): { success: boolean } } | null
  handler(p: unknown): unknown
}

function setup(over: Partial<PilotHost> = {}, scheduler: unknown = null) {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-methods-'))
  writeFileSync(
    join(dir, 'ci.yaml'),
    'name: X\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\n'
  )
  const loaded = loadDefinitions([dir])
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
      scheduler: scheduler as never,
      actions: { entries: () => [], get: () => null }
    },
    ...over
  }
  const methods = buildPilotMethods(host) as unknown as Callable[]
  return (name: string) => methods.find((m) => m.name === name)!
}

describe('Pilot RPC methods', () => {
  it('registers every method as pilot.* with a workspace permission', () => {
    const find = setup()
    const names = [
      'pilot.status',
      'pilot.automations.list',
      'pilot.automations.get',
      'pilot.automations.activity',
      'pilot.automations.dryRun',
      'pilot.automations.tickNow',
      'pilot.automations.reload',
      'pilot.automations.validate',
      'pilot.automations.setEnabled',
      'pilot.run.output',
      'pilot.run.event'
    ]
    for (const n of names) {
      expect(find(n)).toMatchObject({ name: n, permission: 'workspace', pilot: true })
    }
  })

  it('reports the scheduler loop times in pilot.status, null without a scheduler', () => {
    const times = { loopStartedAt: 10, lastLoopFinishedAt: 20 }
    const status = setup(
      {},
      { loopTimes: () => times }
    )('pilot.status').handler(null) as PilotStatus
    expect(status).toMatchObject(times)
    const none = setup({ context: null, error: 'boom' })('pilot.status').handler(
      null
    ) as PilotStatus
    expect(none).toMatchObject({ loopStartedAt: null, lastLoopFinishedAt: null, error: 'boom' })
  })

  it.each([
    { processKind: 'main' as const, expected: true },
    { processKind: 'orcad' as const, expected: false }
  ])(
    "pilot.status says Orca's engine is off only where the hook stops it: $processKind → $expected",
    ({ processKind, expected }) => {
      const status = setup({ processKind })('pilot.status').handler(null) as PilotStatus
      expect(status.orcaAutomationsOff).toBe(expected)
    }
  )

  it("makes every automations method say Pilot isn't running when it failed to start", async () => {
    const find = setup({ context: null, error: 'file is not a database' })
    const names = [
      'list',
      'get',
      'activity',
      'dryRun',
      'tickNow',
      'reload',
      'validate',
      'setEnabled'
    ]
    for (const n of names) {
      await expect(
        Promise.resolve().then(() =>
          find(`pilot.automations.${n}`).handler({ id: 'ci', yaml: 'x' })
        )
      ).rejects.toThrow("Pilot isn't running: file is not a database")
    }
    for (const name of ['pilot.run.output', 'pilot.run.event']) {
      await expect(
        Promise.resolve().then(() =>
          find(name).handler({ runId: 'r', stepIdx: 0, outputs: { a: 1 }, kind: 'x' })
        )
      ).rejects.toThrow("Pilot isn't running: file is not a database")
    }
  })

  it('checks run.output names and values, and caps an event payload at 64 KB', () => {
    const find = setup()
    const output = find('pilot.run.output').params!
    expect(
      output.safeParse({
        runId: 'r',
        stepIdx: 0,
        outputs: { changed: true, n: 2, s: 'x', z: null }
      }).success
    ).toBe(true)
    expect(output.safeParse({ terminal: 't', outputs: { a: 1 } }).success).toBe(true)
    expect(output.safeParse({ runId: 'r', stepIdx: 0, outputs: { 'bad-key': 1 } }).success).toBe(
      false
    )
    expect(output.safeParse({ runId: 'r', stepIdx: 0, outputs: {} }).success).toBe(false)
    expect(output.safeParse({ runId: 'r', stepIdx: -1, outputs: { a: 1 } }).success).toBe(false)
    const event = find('pilot.run.event').params!
    expect(event.safeParse({ runId: 'r', kind: 'pushed', payload: { sha: 'abc' } }).success).toBe(
      true
    )
    expect(event.safeParse({ terminal: 't', kind: 'pushed' }).success).toBe(true)
    expect(event.safeParse({ runId: 'r', kind: 'Pushed!' }).success).toBe(false)
    expect(
      event.safeParse({ runId: 'r', kind: 'big', payload: { x: 'y'.repeat(64 * 1024) } }).success
    ).toBe(false)
  })

  it('caps validate input at 256 KB and activity limit at 200', () => {
    const find = setup()
    const validate = find('pilot.automations.validate').params!
    expect(validate.safeParse({ yaml: 'x'.repeat(256 * 1024) }).success).toBe(true)
    expect(validate.safeParse({ yaml: 'x'.repeat(256 * 1024 + 1) }).success).toBe(false)
    const act = find('pilot.automations.activity').params!
    expect(act.safeParse({ id: 'ci', limit: 200 }).success).toBe(true)
    expect(act.safeParse({ id: 'ci', limit: 201 }).success).toBe(false)
  })

  it('passes the scheduler result of dryRun and tickNow through unchanged', async () => {
    const calls: unknown[] = []
    const scheduler = {
      tickNow: async (id: string, o: unknown) => {
        calls.push([id, o])
        return { status: 'busy' }
      }
    }
    const find = setup({}, scheduler)
    expect(await find('pilot.automations.dryRun').handler({ id: 'ci' })).toEqual({ status: 'busy' })
    expect(await find('pilot.automations.tickNow').handler({ id: 'ci' })).toEqual({
      status: 'busy'
    })
    expect(calls).toEqual([
      ['ci', { dryRun: true }],
      ['ci', { dryRun: false }]
    ])
    await expect(find('pilot.automations.tickNow').handler({ id: 'nope' })).rejects.toThrow(
      'No automation "nope"'
    )
  })
})
