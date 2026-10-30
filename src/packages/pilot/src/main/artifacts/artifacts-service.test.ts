import { describe, expect, it } from 'vitest'
import { ARTIFACTS, artifactsEnvelope, ORDERS } from '../../shared/__fixtures__/artifacts'
import { fakePilotcli } from '../envs/__fixtures__/fake-pilotcli'
import { PILOTCLI_MISSING, pilotcliRunner } from '../envs/pilotcli'
import {
  ARTIFACTS_FRESH_MS,
  artifactsService,
  NEEDS_ARTIFACTS_PILOTCLI,
  UNREADABLE_ARTIFACTS
} from './artifacts-service'

const UNKNOWN_MODULE = {
  v: 1,
  command: '',
  outcome: 'invalid',
  reason: 'unknown module artifacts; pilotcli has: agent, automations, git',
  data: null
}

function setup(binary: 'fake' | 'missing' = 'fake') {
  const fake = fakePilotcli()
  let now = 1_000_000
  const service = artifactsService({
    pilotcli: pilotcliRunner({
      pilotBinDir: '',
      binary: () => (binary === 'fake' ? fake.bin : null),
      baseEnv: fake.env
    }),
    now: () => now
  })
  return {
    fake,
    service,
    wait: (ms: number) => {
      now += ms
    }
  }
}

describe('artifactsService', () => {
  it('reads every artifact, filling a missing field and leaving out a row without an id', async () => {
    const { fake, service } = setup()
    const { tickets: _dropped, ...noTickets } = ORDERS
    fake.answer('artifacts-list-artifacts', {
      json: artifactsEnvelope([...ARTIFACTS, noTickets, { title: 'no id or url' }])
    })
    const payload = await service.list({})
    expect(payload).toMatchObject({ error: null, refreshing: false, fetchedAt: 1_000_000 })
    expect(payload.artifacts.map((a) => a.id)).toEqual([...ARTIFACTS.map((a) => a.id), ORDERS.id])
    expect(payload.artifacts[0]).toEqual(ARTIFACTS[0])
    expect(payload.artifacts.at(-1)?.tickets).toEqual([])
    expect(fake.calls()).toEqual(['artifacts list-artifacts --format json --limit 0'])
  })

  it.each([
    ['an empty index', artifactsEnvelope([]), { artifacts: [], error: null }],
    ['no data', artifactsEnvelope(null), { artifacts: [], error: null }],
    ['data that is no list', artifactsEnvelope({}), { error: UNREADABLE_ARTIFACTS }],
    ['a pilotcli without the module', UNKNOWN_MODULE, { error: NEEDS_ARTIFACTS_PILOTCLI }],
    [
      'a failed envelope',
      { v: 1, command: 'artifacts list-artifacts', outcome: 'failed', reason: 'store locked' },
      { artifacts: [], error: 'store locked' }
    ]
  ])('answers %s', async (_name, json, expected) => {
    const { fake, service } = setup()
    fake.answer('artifacts-list-artifacts', { json, code: json.outcome === 'ok' ? 0 : 1 })
    expect(await service.list({})).toMatchObject(expected)
  })

  it('says pilotcli is missing without running anything', async () => {
    const { service } = setup('missing')
    expect(await service.list({})).toEqual({
      fetchedAt: null,
      artifacts: [],
      error: PILOTCLI_MISSING,
      refreshing: false
    })
  })

  it('reuses a read until it goes stale or a caller refreshes, and keeps the last good read on a failure', async () => {
    const { fake, service, wait } = setup()
    fake.answer('artifacts-list-artifacts', { json: artifactsEnvelope([ORDERS]) })
    await service.list({})
    await service.list({})
    expect(fake.calls()).toHaveLength(1)
    await service.list({ refresh: true })
    expect(fake.calls()).toHaveLength(2)
    wait(ARTIFACTS_FRESH_MS)
    fake.answer('artifacts-list-artifacts', { json: UNKNOWN_MODULE, code: 2 })
    expect(await service.list({})).toMatchObject({
      artifacts: [{ id: ORDERS.id }],
      error: NEEDS_ARTIFACTS_PILOTCLI,
      fetchedAt: 1_000_000
    })
    expect(fake.calls()).toHaveLength(3)
  })

  it('runs one read for callers that ask at once', async () => {
    const { fake, service } = setup()
    fake.answer('artifacts-list-artifacts', { json: artifactsEnvelope([ORDERS]) })
    await Promise.all([service.list({}), service.list({ refresh: true }), service.list({})])
    expect(fake.calls()).toHaveLength(1)
  })

  it('answers a slow read with what it has, refreshing, and the next call gets the read', async () => {
    const fake = fakePilotcli()
    fake.answer('artifacts-list-artifacts', { json: artifactsEnvelope([ORDERS]), sleep: 0.3 })
    const service = artifactsService({
      pilotcli: pilotcliRunner({ pilotBinDir: '', binary: () => fake.bin, baseEnv: fake.env }),
      waitMs: 20
    })
    expect(await service.list({})).toMatchObject({ artifacts: [], refreshing: true })
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(await service.list({})).toMatchObject({
      artifacts: [{ id: ORDERS.id }],
      refreshing: false
    })
    expect(fake.calls()).toHaveLength(1)
  })
})
