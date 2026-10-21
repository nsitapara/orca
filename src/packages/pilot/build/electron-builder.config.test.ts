import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const config = require('./electron-builder.config.cjs')
const base = require('../../../../config/electron-builder.config.cjs')

describe('Pilot electron-builder wrapper', () => {
  it('renames the app and keeps its own data folder', () => {
    expect(config.appId).toBe('dev.nsitapara.pilot')
    expect(config.productName).toBe('Pilot')
    expect(config.extraMetadata.name).toBe('pilot')
  })

  it('signs the mac bundle ad hoc, which macOS needs before it registers Pilot for notifications', () => {
    expect(config.mac.identity).toBe('-')
  })

  it('registers pilot:// and never orca:// (D25)', () => {
    expect(config.protocols).toEqual([{ name: 'Pilot', schemes: ['pilot'] }])
  })

  it('turns off the release feed so upstream releases never replace Pilot', () => {
    expect(config.publish).toBeNull()
  })

  it("ships both launchers from Pilot, and Orca's launcher is replaced", () => {
    const resources = config.mac.extraResources.map(
      (r: { from: string; to: string }) => `${r.from} -> ${r.to}`
    )
    expect(resources).toContain('src/packages/pilot/build/bin/pilot -> bin/pilot')
    expect(resources).toContain('src/packages/pilot/build/bin/orca -> bin/orca')
    expect(resources.some((r: string) => r.startsWith('resources/darwin/bin/orca '))).toBe(false)
  })

  it("ships Pilot's resources folder where pilotResourcesDir reads it", () => {
    expect(config.mac.extraResources).toContainEqual({
      from: 'src/packages/pilot/resources',
      to: 'pilot'
    })
  })

  it("ships no Computer Use helper, which would share Orca's bundle id", () => {
    const entries = config.mac.extraResources.map((r: { from?: string; to?: string } | string) =>
      JSON.stringify(r)
    )
    expect(entries.filter((e: string) => e.includes('Computer Use'))).toEqual([])
  })

  it('unpacks the CLI code Pilot adds', () => {
    expect(config.asarUnpack).toContain('out/packages/pilot/**')
  })

  it('leaves the base config untouched', () => {
    expect(base.productName).toBe('Orca')
  })
})
