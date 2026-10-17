import { hostname } from 'node:os'
import { describe, expect, it } from 'vitest'
import { normalizeMachineName } from '../../../../shared/machine-name'
import { engineMachineName } from './pilot-host'

describe('engineMachineName', () => {
  it.each([
    ["the runtime's published name", () => 'Mac mini', 'Mac mini'],
    ['the hostname when the runtime publishes none', () => '  ', normalizeMachineName(hostname())],
    [
      'the hostname when the runtime throws',
      () => {
        throw new Error('no store')
      },
      normalizeMachineName(hostname())
    ]
  ])('names the engine by %s', (_why, readMachineName, expected) => {
    expect(engineMachineName({ readMachineName })).toBe(expected)
  })
})
