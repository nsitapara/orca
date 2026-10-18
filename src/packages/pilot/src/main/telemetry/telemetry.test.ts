import { describe, expect, it } from 'vitest'
import {
  CALLS,
  envelope,
  NEW_CATALOG,
  NEW_USAGE,
  NEW_USAGE_CLEAN,
  TODAY_CATALOG,
  TODAY_USAGE
} from '../../shared/__fixtures__/telemetry'
import { fakePilotcli } from '../envs/__fixtures__/fake-pilotcli'
import { pilotcliRunner } from '../envs/pilotcli'
import {
  BAD_COMMAND,
  FAILURES_SHOWN,
  NEEDS_NEWER_PILOTCLI,
  telemetryService,
  UNREADABLE
} from './telemetry'

const P = { since: '7d', includeDev: false } as const

function setup(catalog: unknown, usage: unknown) {
  const fake = fakePilotcli()
  fake.answer('self-list-commands', { json: envelope('self list-commands', catalog) })
  fake.answer('self-get-telemetry', { json: envelope('self get-telemetry', usage) })
  let now = 1_000_000
  let mtimeMs = 1
  const service = telemetryService({
    pilotcli: pilotcliRunner({ pilotBinDir: '', binary: () => fake.bin, baseEnv: fake.env }),
    binary: () => ({ path: fake.bin, mtimeMs }),
    now: () => now
  })
  return {
    fake,
    service,
    wait: (ms: number) => {
      now += ms
    },
    reinstall: () => {
      mtimeMs += 1
    }
  }
}

describe('telemetryService', () => {
  it("reads today's pilotcli without a flag or a command it would refuse", async () => {
    const { fake, service } = setup(TODAY_CATALOG, TODAY_USAGE)
    expect(await service.get(P)).toMatchObject({
      usage: { calls: 3 },
      failures: { unavailable: NEEDS_NEWER_PILOTCLI }
    })
    expect(fake.calls()).toEqual([
      'self list-commands --format json',
      'self get-telemetry --since 7d --include-dev false --format json'
    ])
  })

  it('asks a newer pilotcli for the per-day series and the failed and invalid calls', async () => {
    const { fake, service } = setup(NEW_CATALOG, NEW_USAGE)
    fake.answer('self-list-telemetry-calls', { json: envelope('self list-telemetry-calls', CALLS) })
    const got = await service.get({ since: '30d', includeDev: true, command: 'gitlab check-mr' })
    expect(fake.calls().slice(1)).toEqual([
      'self get-telemetry --since 30d --include-dev true --series day --format json',
      'self list-telemetry-calls outcome=failed,invalid command="gitlab check-mr" --since 30d --include-dev true --limit 51 --format json'
    ])
    expect(got).toMatchObject({
      usage: { buckets: NEW_USAGE.buckets },
      failures: { calls: CALLS, more: false }
    })
  })

  it('shows 50 calls and says there are more when pilotcli has a 51st', async () => {
    const { fake, service } = setup(NEW_CATALOG, NEW_USAGE)
    const many = Array.from({ length: FAILURES_SHOWN + 1 }, () => CALLS[0])
    fake.answer('self-list-telemetry-calls', { json: envelope('self list-telemetry-calls', many) })
    const got = await service.get(P)
    expect('usage' in got && got.failures).toMatchObject({ more: true })
    expect('usage' in got && 'calls' in got.failures && got.failures.calls).toHaveLength(
      FAILURES_SHOWN
    )
  })

  it('skips the list call when nothing failed or was invalid', async () => {
    const { fake, service } = setup(NEW_CATALOG, NEW_USAGE_CLEAN)
    expect(await service.get(P)).toMatchObject({ failures: { calls: [], more: false } })
    expect(fake.calls().some((c) => c.startsWith('self list-telemetry-calls'))).toBe(false)
  })

  it.each([
    // An answer replaces setup's ok envelope: readReply trusts an envelope over the exit code.
    [
      'a failed call',
      {
        json: {
          ...envelope('self get-telemetry', null),
          outcome: 'failed',
          reason: "can't read the telemetry file: boom"
        },
        code: 1
      },
      /boom/
    ],
    [
      'data in a shape Pilot does not read',
      { json: envelope('self get-telemetry', { calls: 'many' }) },
      UNREADABLE
    ]
  ])('answers %s as an error, never a throw', async (_name, reply, error) => {
    const { fake, service } = setup(NEW_CATALOG, NEW_USAGE)
    fake.answer('self-get-telemetry', reply)
    const got = await service.get(P)
    expect('error' in got && got.error).toMatch(error)
  })

  it('keeps the usage when the list answers badly', async () => {
    const { fake, service } = setup(NEW_CATALOG, NEW_USAGE)
    fake.answer('self-list-telemetry-calls', {
      json: envelope('self list-telemetry-calls', [{ ts: 1 }])
    })
    expect(await service.get(P)).toMatchObject({
      usage: { calls: NEW_USAGE.calls },
      failures: { unavailable: UNREADABLE }
    })
  })

  it('caches each answer 30 s, and a command reuses the window’s usage', async () => {
    const { fake, service, wait } = setup(NEW_CATALOG, NEW_USAGE_CLEAN)
    const first = await service.get(P)
    wait(29_999)
    expect(await service.get(P)).toEqual(first)
    await service.get({ ...P, command: 'gitlab check-mr' })
    wait(1)
    await service.get(P)
    const reads = fake.calls().filter((c) => c.startsWith('self get-telemetry'))
    expect(reads).toHaveLength(2)
    expect(first.fetchedAt).toBe(1_000_000)
  })

  it('reads the catalog once per installed binary', async () => {
    const { fake, service, reinstall } = setup(NEW_CATALOG, NEW_USAGE_CLEAN)
    await service.get(P)
    await service.get({ ...P, since: '30d' })
    reinstall()
    await service.get({ ...P, since: '90d' })
    expect(fake.calls().filter((c) => c.startsWith('self list-commands'))).toHaveLength(2)
  })

  it('shares one pilotcli call between concurrent callers', async () => {
    const { fake, service } = setup(NEW_CATALOG, NEW_USAGE_CLEAN)
    const [a, b] = await Promise.all([service.get(P), service.get(P)])
    expect(a).toEqual(b)
    expect(fake.calls().filter((c) => c.startsWith('self get-telemetry'))).toHaveLength(1)
  })

  it('does not keep an error: the next call asks pilotcli again', async () => {
    const { fake, service } = setup(NEW_CATALOG, NEW_USAGE)
    fake.answer('self-list-telemetry-calls', {
      json: envelope('self list-telemetry-calls', [{ ts: 1 }])
    })
    expect(await service.get(P)).toMatchObject({ failures: { unavailable: UNREADABLE } })
    fake.answer('self-list-telemetry-calls', { json: envelope('self list-telemetry-calls', CALLS) })
    expect(await service.get(P)).toMatchObject({ failures: { calls: CALLS } })
    const failed = { ...envelope('self get-telemetry', null), outcome: 'failed', reason: 'boom' }
    fake.answer('self-get-telemetry', { json: failed, code: 1 })
    expect(await service.get({ ...P, since: '30d' })).toMatchObject({
      error: expect.stringMatching(/boom/)
    })
    fake.answer('self-get-telemetry', { json: envelope('self get-telemetry', NEW_USAGE_CLEAN) })
    expect(await service.get({ ...P, since: '30d' })).toMatchObject({
      usage: { calls: NEW_USAGE.calls }
    })
  })

  it('answers a failed catalog read as an error and reads it again, not as "needs a newer pilotcli"', async () => {
    const { fake, service } = setup(NEW_CATALOG, NEW_USAGE_CLEAN)
    const failed = {
      ...envelope('self list-commands', null),
      outcome: 'failed',
      reason: 'no catalog'
    }
    fake.answer('self-list-commands', { json: failed, code: 1 })
    expect(await service.get(P)).toMatchObject({ error: expect.stringMatching(/no catalog/) })
    fake.answer('self-list-commands', {
      json: envelope('self list-commands', NEW_CATALOG),
      code: 0
    })
    expect(await service.get(P)).toMatchObject({ failures: { calls: [], more: false } })
  })

  it('refuses a command name that could add to the quoted condition', async () => {
    const { fake, service } = setup(NEW_CATALOG, NEW_USAGE)
    const got = await service.get({ ...P, command: 'git get-branch" outcome=ok' })
    expect(got).toMatchObject({ error: BAD_COMMAND })
    expect(fake.calls()).toEqual([])
  })
})
