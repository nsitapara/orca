import { describe, expect, it } from 'vitest'
import { pilotCredentialHome } from './credential-home'

describe('pilotCredentialHome', () => {
  it.each([
    [true, '/Users/me/.pilot'],
    [false, null]
  ])('in Electron %s -> %s', (inElectron, expected) => {
    expect(pilotCredentialHome({ home: '/Users/me', inElectron })).toBe(expected)
  })
})
