import { describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { PilotStore } from '../store/store'
import { registerPilotSources } from './register-sources'
import { itemSource } from './registry'

describe('registerPilotSources', () => {
  it('registers the runtime-backed sources without touching the runtime yet', () => {
    registerPilotSources({
      runtime: {} as OrcaRuntimeService,
      pilotBinDir: '/unused',
      store: {} as PilotStore
    })
    expect(itemSource('worktree').kind).toBe('worktree')
    expect(itemSource('linear_ticket').kind).toBe('linear_ticket')
    expect(itemSource('inbox_preparation').kind).toBe('inbox_preparation')
    expect(itemSource('kept_branch').kind).toBe('kept_branch')
  })
})
