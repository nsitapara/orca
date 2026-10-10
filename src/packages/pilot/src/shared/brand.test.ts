import { describe, expect, it } from 'vitest'
import { pilotBrand } from './brand'

describe('pilotBrand', () => {
  it.each([
    ['Orca', 'Pilot'],
    ['Quit Orca', 'Quit Pilot'],
    ['About Orca…', 'About Pilot…'],
    ["Orca's settings", "Pilot's settings"],
    ['Open in Orca Mobile', 'Open in Orca Mobile'],
    ['Orca Cloud sharing', 'Orca Cloud sharing'],
    ['Visit onorca.dev', 'Visit onorca.dev'],
    ['orca://pair?code=abc', 'orca://pair?code=abc'],
    ['Orcas are whales', 'Orcas are whales'],
    ['run `orca status`', 'run `orca status`']
  ])('%s → %s', (input, expected) => {
    expect(pilotBrand(input)).toBe(expected)
  })
})
