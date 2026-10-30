import { describe, expect, it, vi } from 'vitest'
import type { ArtifactsListParams, ArtifactsPayload } from '../../shared/api-types-artifacts'
import { buildArtifactsMethods } from './methods-artifacts'

type Callable = {
  name: string
  permission: string
  params: { safeParse(v: unknown): { success: boolean } }
  handler(p: unknown, rpc?: { caller?: { kind: string } }): Promise<unknown>
}

const PAYLOAD: ArtifactsPayload = { fetchedAt: 1, artifacts: [], error: null, refreshing: false }

describe('pilot.artifacts.list', () => {
  it('answers any caller, refreshes on request, and makes its service once', async () => {
    const list = vi.fn(async (_p: ArtifactsListParams) => PAYLOAD)
    const make = vi.fn(() => ({ list }))
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: defineMethod's objects have name, permission, params and handler.
    const [m] = buildArtifactsMethods(
      () => ({ engineEnv: undefined }),
      make
    ) as unknown as Callable[]
    expect(m).toMatchObject({ name: 'pilot.artifacts.list', permission: 'workspace' })
    expect(m.params.safeParse({ refresh: 'yes' }).success).toBe(false)
    for (const rpc of [{ caller: { kind: 'desktop' } }, { caller: { kind: 'paired-device' } }]) {
      expect(await m.handler({ refresh: true }, rpc)).toBe(PAYLOAD)
    }
    expect(list).toHaveBeenLastCalledWith({ refresh: true })
    expect(make).toHaveBeenCalledTimes(1)
  })
})
