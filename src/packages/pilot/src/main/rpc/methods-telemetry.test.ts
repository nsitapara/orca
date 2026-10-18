import { describe, expect, it, vi } from 'vitest'
import type { TelemetryParams } from '../../shared/api-types-telemetry'
import { PAYLOAD } from '../../shared/__fixtures__/telemetry'
import { buildTelemetryMethods, TelemetryGet } from './methods-telemetry'

type Callable = {
  name: string
  permission: string
  handler(p: unknown, rpc?: { caller?: { kind: string } }): Promise<unknown>
}

function method(get = vi.fn(async (_p: TelemetryParams) => PAYLOAD)) {
  const make = vi.fn(() => ({ get }))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: defineMethod's objects have name, permission and handler.
  const [m] = buildTelemetryMethods(() => ({ engineEnv: undefined }), make) as unknown as Callable[]
  return { m, get, make }
}

describe('pilot.telemetry.get', () => {
  it.each([
    [{ since: '7d', includeDev: false }, true],
    [{ since: '90d', includeDev: true, command: 'gitlab check-mr' }, true],
    [{ since: '24h', includeDev: false }, false],
    [{ since: '7d' }, false],
    [{ since: '7d', includeDev: false, command: 'gitlab check-mr; rm -rf ~' }, false],
    [{ since: '7d', includeDev: false, command: 'jane.patient@clinic.test' }, false],
    [{ since: '7d', includeDev: false, command: '' }, false],
    [{ since: '7d', includeDev: false, command: 'inbox' }, false]
  ])('params %o valid: %s', (params, ok) => {
    expect(TelemetryGet.safeParse(params).success).toBe(ok)
  })

  it('answers any caller, and makes its service once', async () => {
    const { m, get, make } = method()
    for (const rpc of [
      { caller: { kind: 'desktop' } },
      { caller: { kind: 'paired-device' } },
      {}
    ]) {
      expect(await m.handler({ since: '7d', includeDev: false }, rpc)).toBe(PAYLOAD)
    }
    expect(m).toMatchObject({ name: 'pilot.telemetry.get', permission: 'workspace' })
    expect(get).toHaveBeenCalledTimes(3)
    expect(make).toHaveBeenCalledTimes(1)
  })
})
