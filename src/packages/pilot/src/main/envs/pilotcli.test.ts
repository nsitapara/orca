import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fakePilotcli } from './__fixtures__/fake-pilotcli'
import { PILOTCLI_MISSING, pilotcliPath, pilotcliRunner } from './pilotcli'

const CREATE = ['env', 'create', '--run', 'r1', '--worktree', '/wt/a', '--format', 'json']
const envelope = (outcome: string, reason = '', data: unknown = null) => ({
  v: 1,
  command: 'env create',
  outcome,
  reason,
  data,
  meta: {}
})

function runnerFor(fake: ReturnType<typeof fakePilotcli>, base: NodeJS.ProcessEnv = fake.env) {
  return pilotcliRunner({
    pilotBinDir: '/Applications/Pilot.app/Contents/Resources/bin',
    binary: () => fake.bin,
    baseEnv: base
  })
}

describe('pilotcliRunner reads the outcome', () => {
  it.each([
    [
      'an ok envelope',
      { json: envelope('ok', '', { mode: 'in_place' }), code: 0 },
      { outcome: 'ok', reason: '', data: { mode: 'in_place' } }
    ],
    [
      'a not_yet envelope',
      { json: envelope('not_yet', 'the stack cap is reached'), code: 5 },
      { outcome: 'not_yet', reason: 'the stack cap is reached' }
    ],
    [
      'the envelope over the code',
      { json: envelope('failed', 'setup failed'), code: 0 },
      { outcome: 'failed', reason: 'setup failed' }
    ],
    [
      'exit 2 without an envelope',
      { code: 2, stderr: 'bad flags: --keep needs --new-branch\n' },
      { outcome: 'invalid', reason: 'bad flags: --keep needs --new-branch' }
    ],
    ['exit 5 without an envelope', { code: 5 }, { outcome: 'not_yet', reason: '' }],
    ['exit 3 without an envelope', { code: 3 }, { outcome: 'skip', reason: '' }],
    [
      'an exit code outside the contract',
      { code: 4, stderr: 'panic: nil map\n' },
      { outcome: 'failed', reason: 'pilotcli env create exited 4: panic: nil map' }
    ]
  ])('%s', async (_name, reply, expected) => {
    const fake = fakePilotcli()
    fake.answer('env-create', reply)
    await expect(runnerFor(fake)({ args: CREATE, timeoutMs: 10_000 })).resolves.toMatchObject(
      expected
    )
  })

  it('fails with where to put it when pilotcli is missing', async () => {
    const run = pilotcliRunner({ pilotBinDir: '', binary: () => null })
    await expect(run({ args: CREATE, timeoutMs: 1000 })).resolves.toMatchObject({
      outcome: 'failed',
      reason: PILOTCLI_MISSING
    })
  })

  it('fails a call that runs past its timeout', async () => {
    const fake = fakePilotcli()
    fake.answer('env-create', { sleep: 30 })
    await expect(runnerFor(fake)({ args: CREATE, timeoutMs: 300 })).resolves.toMatchObject({
      outcome: 'failed',
      reason: expect.stringContaining('pilotcli env create timed out after')
    })
  })
})

describe('pilotcliRunner reaches real Orca, never Pilot', () => {
  it("drops Pilot's ORCA_*/PILOT_* routing and its launcher folder", async () => {
    const fake = fakePilotcli()
    fake.answer('env-create', { json: envelope('ok'), code: 0 })
    const bin = '/Applications/Pilot.app/Contents/Resources/bin'
    const base = {
      ...fake.env,
      PATH: `${bin}:${fake.env.PATH}`,
      ORCA_USER_DATA_PATH: '/pilot',
      PILOT_RUN_ID: 'x',
      ORCA_TERMINAL_HANDLE: 't'
    }
    await runnerFor(fake, base)({ args: CREATE, timeoutMs: 10_000 })
    expect(fake.read('env.log').trim()).toBe('')
    expect(fake.read('path.log')).not.toContain(bin)
  })
})

describe('pilotcliRunner marks its calls', () => {
  it('as Pilot’s own, for pilotcli’s telemetry (caller app)', async () => {
    const fake = fakePilotcli()
    fake.answer('env-create', { json: envelope('ok'), code: 0 })
    await runnerFor(fake, { ...fake.env, PILOT_RUN_ID: 'x', PILOTCLI_CALLER: 'someone-else' })({
      args: CREATE,
      timeoutMs: 10_000
    })
    expect(fake.read('caller.log').trim()).toBe('pilot-app')
    expect(fake.read('env.log').trim()).toBe('')
  })
})

describe('pilotcliRunner finds pilotcli', () => {
  // The app's own env names a pilotcli that doesn't exist, so a lookup that ignores baseEnv fails here and can never
  // reach a real ~/.local/bin/pilotcli.
  it('in the env it was given, not the app’s own', async () => {
    vi.stubEnv('PILOT_PILOTCLI', '/nonexistent/pilotcli')
    try {
      const fake = fakePilotcli()
      fake.answer('env-create', { json: envelope('ok'), code: 0 })
      const run = pilotcliRunner({
        pilotBinDir: '/Applications/Pilot.app/Contents/Resources/bin',
        baseEnv: { ...fake.env, PILOT_PILOTCLI: fake.bin }
      })
      await expect(run({ args: CREATE, timeoutMs: 10_000 })).resolves.toMatchObject({
        outcome: 'ok'
      })
      expect(fake.calls()).toHaveLength(1)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('pilotcliRunner, its process group', () => {
  it('writes the pid file naming pilotcli itself, and an abort stops the whole group', async () => {
    const fake = fakePilotcli()
    fake.answer('env-create', { sleep: 30 })
    const pidFile = join(mkdtempSync(join(tmpdir(), 'pid-')), 'r1.pid')
    const controller = new AbortController()
    const call = runnerFor(fake)({
      args: CREATE,
      timeoutMs: 60_000,
      signal: controller.signal,
      pidFile
    })
    while (!existsSync(join(fake.dir, 'env-create.pid'))) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const pid = Number(fake.read('env-create.pid'))
    expect(Number(readFileSync(pidFile, 'utf8'))).toBe(pid)
    const started = Date.now()
    controller.abort()
    await call
    expect(Date.now() - started).toBeLessThan(5000)
    expect(() => process.kill(pid, 0)).toThrow()
    // pilotcli leads its process group (sh wrote $$, then exec'd it): nothing it started is left.
    expect(() => process.kill(-pid, 0)).toThrow()
  })
})

describe('pilotcliPath', () => {
  const executable = (paths: string[]) => (p: string) => paths.includes(p)
  it.each([
    [
      'PILOT_PILOTCLI, with ~ expanded',
      { PILOT_PILOTCLI: '~/bin/pc', PATH: '/usr/bin' },
      [],
      '/Users/n/bin/pc'
    ],
    [
      '~/.local/bin/pilotcli',
      { PATH: '/opt/bin' },
      ['/Users/n/.local/bin/pilotcli', '/opt/bin/pilotcli'],
      '/Users/n/.local/bin/pilotcli'
    ],
    ['then PATH', { PATH: '/usr/bin:/opt/bin' }, ['/opt/bin/pilotcli'], '/opt/bin/pilotcli'],
    [
      'skips a PATH entry that is not absolute',
      { PATH: 'bin:./tools:/opt/bin' },
      ['bin/pilotcli', 'tools/pilotcli', '/opt/bin/pilotcli'],
      '/opt/bin/pilotcli'
    ],
    ['nowhere', { PATH: '/usr/bin' }, [], null]
  ])('%s', (_name, env, found, expected) => {
    expect(pilotcliPath(env, '/Users/n', executable(found))).toBe(expected)
  })
})
