// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installBrowserGlobals,
  writeStoredRuntimeEnvironment
} from '../../../../renderer/src/web/web-preload-api-test-harness'

describe("browser version's 'active' environment selector", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('../../../../renderer/src/web/web-runtime-client')
  })

  it("reaches the paired server through the 'active' selector with the caller's timeout", async () => {
    const call = vi.fn((method: string) =>
      Promise.resolve({ id: method, ok: true, result: 'done', _meta: { runtimeId: 'r' } })
    )
    vi.doMock('../../../../renderer/src/web/web-runtime-client', () => ({
      WebRuntimeClient: class {
        call = call
        close(): void {}
      }
    }))
    const globals = installBrowserGlobals('Linux')
    writeStoredRuntimeEnvironment(globals.storage, 'web-server-a')
    const { installWebPreloadApi } = await import('../../../../renderer/src/web/web-preload-api')
    installWebPreloadApi()

    await expect(
      globals.window.api.runtimeEnvironments.call({
        selector: 'active',
        method: 'pilot.automations.dryRun',
        params: { id: 'a' },
        timeoutMs: 180_000
      })
    ).resolves.toMatchObject({ ok: true, result: 'done' })
    expect(call).toHaveBeenLastCalledWith(
      'pilot.automations.dryRun',
      { id: 'a' },
      { timeoutMs: 180_000 }
    )
  })
})
