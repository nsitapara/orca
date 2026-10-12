import { describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { PilotStore } from '../store/store'
import { registerPilotSources } from './register-sources'
import { itemSource } from './registry'

describe('registerPilotSources', () => {
  it('registers the runtime-backed sources without touching the runtime yet', () => {
    registerPilotSources({
      runtime: {} as OrcaRuntimeService,
      store: {} as PilotStore
    })
    expect(itemSource('worktree').kind).toBe('worktree')
  })
})
