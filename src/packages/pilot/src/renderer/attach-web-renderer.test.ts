// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fakeStore = { getState: () => ({ rightSidebarOpen: false, setRightSidebarOpen: () => {} }) }
const app = { default: 'App' }

describe('withPilotWebRenderer', () => {
  beforeEach(vi.resetModules)
  afterEach(async () => {
    // The store module this test imported, not a stale copy from before resetModules.
    const { registerPilotStore } = await import('./store')
    registerPilotStore(null)
    vi.doUnmock('@/store')
    vi.restoreAllMocks()
  })

  it("doesn't load the app store when the web entry imports it", async () => {
    let evaluated = false
    vi.doMock('@/store', () => {
      evaluated = true
      return { useAppStore: fakeStore }
    })
    await import('./attach-web-renderer')
    expect(evaluated).toBe(false)
  })

  it('registers the app store before the app shell resolves', async () => {
    vi.doMock('@/store', () => ({ useAppStore: fakeStore }))
    const { withPilotWebRenderer } = await import('./attach-web-renderer')
    const { pilotStore } = await import('./store')
    await expect(withPilotWebRenderer(Promise.resolve(app))).resolves.toBe(app)
    expect(pilotStore()).toBe(fakeStore)
  })

  it('still loads the app shell when Pilot fails to attach', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { withPilotWebRenderer } = await import('./attach-web-renderer')
    await expect(
      withPilotWebRenderer(Promise.resolve(app), () => Promise.reject(new Error('chunk gone')))
    ).resolves.toBe(app)
    expect(error).toHaveBeenCalledWith('[pilot] web renderer attach failed: chunk gone')
  })

  it('passes an app shell load failure through, so lazyWithRetry can retry it', async () => {
    const failure = new Error('App chunk failed')
    const { withPilotWebRenderer } = await import('./attach-web-renderer')
    await expect(withPilotWebRenderer(Promise.reject(failure), async () => {})).rejects.toBe(
      failure
    )
  })
})
