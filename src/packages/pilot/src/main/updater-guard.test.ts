import { describe, expect, it } from 'vitest'
import { isPilotUpdaterDisabled } from './updater-guard'

describe('isPilotUpdaterDisabled', () => {
  it.each([
    { inElectron: true, env: {}, expected: true },
    { inElectron: true, env: { PILOT_ENABLE_UPDATER: '1' }, expected: false },
    { inElectron: true, env: { PILOT_ENABLE_UPDATER: '0' }, expected: true },
    { inElectron: false, env: {}, expected: false }
  ])('inElectron=$inElectron env=$env -> $expected', ({ inElectron, env, expected }) => {
    expect(isPilotUpdaterDisabled({ inElectron, env })).toBe(expected)
  })
})
