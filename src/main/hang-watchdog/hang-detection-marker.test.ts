import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import type * as FileSystem from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  consumeHangDetectionMarker,
  hangDetectionMarkerPath,
  writeHangDetectionMarker
} from './hang-detection-marker'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystem>()
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    statSync: vi.fn(actual.statSync),
    writeFileSync: vi.fn(actual.writeFileSync)
  }
})

describe('hang detection marker', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hang-marker-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips a marker and deletes it on consume', () => {
    const markerPath = hangDetectionMarkerPath(dir)
    writeHangDetectionMarker(markerPath, {
      detectedAt: 123,
      parentPid: 456,
      unresponsiveMs: 45000,
      selfRecovered: false
    })
    expect(consumeHangDetectionMarker(markerPath)).toEqual({
      detectedAt: 123,
      parentPid: 456,
      unresponsiveMs: 45000,
      selfRecovered: false
    })
    expect(existsSync(markerPath)).toBe(false)
    expect(consumeHangDetectionMarker(markerPath)).toBeNull()
  })

  it('round-trips a self-recovered marker', () => {
    const markerPath = hangDetectionMarkerPath(dir)
    writeHangDetectionMarker(markerPath, {
      detectedAt: 1,
      parentPid: 2,
      unresponsiveMs: 61000,
      selfRecovered: true
    })
    expect(consumeHangDetectionMarker(markerPath)).toMatchObject({ selfRecovered: true })
  })

  // Why: the 10-16 freeze left no record; a rewrite cut short must never cost the earlier note.
  it('keeps the previous marker intact when a rewrite fails', () => {
    const markerPath = hangDetectionMarkerPath(dir)
    const marker = { detectedAt: 1, parentPid: 2, unresponsiveMs: 45000, selfRecovered: false }
    writeHangDetectionMarker(markerPath, marker)
    // A write cut short has already truncated the file it was writing.
    vi.mocked(writeFileSync).mockImplementationOnce((path) => {
      closeSync(openSync(String(path), 'w'))
      throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
    })
    expect(() =>
      writeHangDetectionMarker(markerPath, { ...marker, unresponsiveMs: 90000 })
    ).toThrow('no space left on device')
    expect(consumeHangDetectionMarker(markerPath)).toEqual(marker)
  })

  it('returns null for a missing marker', () => {
    expect(consumeHangDetectionMarker(hangDetectionMarkerPath(dir))).toBeNull()
  })

  it.each(['stat', 'read'])('retains a real marker after a transient %s failure', (operation) => {
    const markerPath = hangDetectionMarkerPath(dir)
    const marker = { detectedAt: 1, parentPid: 2, unresponsiveMs: 45000, selfRecovered: false }
    writeHangDetectionMarker(markerPath, marker)
    const fail = (): never => {
      throw Object.assign(new Error('temporary I/O failure'), { code: 'EIO' })
    }
    if (operation === 'stat') {
      vi.mocked(statSync).mockImplementationOnce(fail)
    } else {
      vi.mocked(readFileSync).mockImplementationOnce(fail)
    }
    expect(consumeHangDetectionMarker(markerPath)).toBeNull()
    expect(existsSync(markerPath)).toBe(true)
    expect(consumeHangDetectionMarker(markerPath)).toEqual(marker)
    expect(existsSync(markerPath)).toBe(false)
  })

  it('deletes an oversized marker without reading its contents', () => {
    const markerPath = hangDetectionMarkerPath(dir)
    writeFileSync(markerPath, 'x'.repeat(64 * 1024 + 1))
    vi.mocked(readFileSync).mockClear()
    expect(consumeHangDetectionMarker(markerPath)).toBe('unreadable')
    expect(readFileSync).not.toHaveBeenCalled()
    expect(existsSync(markerPath)).toBe(false)
  })

  // Why: a marker written by the detect leg has no selfRecovered field until the resolve leg
  // rewrites it, and "never resolved" is the conservative reading of its absence.
  it('treats a missing selfRecovered flag as an unresolved hang', () => {
    const markerPath = hangDetectionMarkerPath(dir)
    writeFileSync(
      markerPath,
      JSON.stringify({ detectedAt: 1, parentPid: 2, unresponsiveMs: 45000 })
    )
    expect(consumeHangDetectionMarker(markerPath)).toMatchObject({ selfRecovered: false })
  })

  it.each(['', 'not json', JSON.stringify({ detectedAt: 1 })])(
    'reports a corrupted or incomplete marker as unreadable and still deletes it: %j',
    (contents) => {
      const markerPath = hangDetectionMarkerPath(dir)
      writeFileSync(markerPath, contents)
      expect(consumeHangDetectionMarker(markerPath)).toBe('unreadable')
      expect(existsSync(markerPath)).toBe(false)
    }
  )
})
