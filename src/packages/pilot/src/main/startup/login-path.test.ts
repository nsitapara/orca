import { describe, expect, it } from 'vitest'
import type { HydrationResult } from '../../../../../main/startup/hydrate-shell-path'
import { loginPath } from './login-path'

const SEGMENTS = ['/opt/homebrew/bin', '/Users/n/.local/bin', '/usr/bin']
const FOUND: HydrationResult = { ok: true, segments: SEGMENTS, failureReason: 'none' }
const TIMED_OUT: HydrationResult = { ok: false, segments: [], failureReason: 'timeout' }

describe('loginPath', () => {
  it.each([
    ['the startup probe found it', [FOUND], [false], [SEGMENTS], []],
    [
      'the startup probe timed out behind the Keychain prompt',
      [TIMED_OUT, FOUND],
      [false, true],
      [SEGMENTS],
      ['[pilot] login-shell PATH probe failed (timeout); probing again']
    ],
    [
      'every probe fails',
      [TIMED_OUT, TIMED_OUT, TIMED_OUT],
      [false, true, true],
      [],
      [
        '[pilot] login-shell PATH probe failed (timeout); probing again',
        '[pilot] login-shell PATH probe failed (timeout); probing again',
        "[pilot] login-shell PATH probe failed (timeout); steps run with Pilot's seeded PATH"
      ]
    ]
  ])('when %s', async (_name, results, forced, merged, logs) => {
    const probes: boolean[] = []
    const merges: string[][] = []
    const lines: string[] = []
    await loginPath({
      probe: async (force) => {
        probes.push(force)
        return results[probes.length - 1]
      },
      merge: (segments) => merges.push(segments),
      log: (message) => lines.push(message)
    })
    expect(probes).toEqual(forced)
    expect(merges).toEqual(merged)
    expect(lines).toEqual(logs)
  })
})
