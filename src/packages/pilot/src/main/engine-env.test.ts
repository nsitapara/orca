import { describe, expect, it } from 'vitest'
import { engineChildEnv, pilotBinDir, resolveEngineEnv } from './engine-env'

const env = { binDir: '/Apps/Pilot.app/Contents/Resources/bin', dataDir: '/data/pilot' }

describe('engineChildEnv', () => {
  it("puts Pilot's bin folder first on PATH and names its data folder", () => {
    expect(engineChildEnv(env, {}, { PATH: '/usr/bin:/bin' })).toEqual({
      PATH: '/Apps/Pilot.app/Contents/Resources/bin:/usr/bin:/bin',
      ORCA_USER_DATA_PATH: '/data/pilot'
    })
  })

  it('adds the extra variables last, so they win', () => {
    const out = engineChildEnv(
      env,
      { ORCA_USER_DATA_PATH: '/other', PILOT_RUN_ID: 'r1' },
      { PATH: '/usr/bin' }
    )
    expect(out).toMatchObject({ ORCA_USER_DATA_PATH: '/other', PILOT_RUN_ID: 'r1' })
  })

  it.each([
    ['no PATH at all', { binDir: '/bin', dataDir: '/d' }, {}, '/bin'],
    ['no bin folder (orcad)', { binDir: '', dataDir: '/d' }, { PATH: '/usr/bin' }, '/usr/bin']
  ])('PATH with %s', (_name, engine, base, path) => {
    expect(engineChildEnv(engine, {}, base).PATH).toBe(path)
  })
})

describe('pilotBinDir', () => {
  it.each([
    [
      'packaged',
      { packaged: true, resourcesPath: '/Apps/Pilot.app/Contents/Resources', appPath: '/x' },
      '/Apps/Pilot.app/Contents/Resources/bin'
    ],
    [
      'dev',
      { packaged: false, resourcesPath: '/electron/Resources', appPath: '/repo' },
      '/repo/src/packages/pilot/build/bin'
    ],
    [
      'packaged without a resources path',
      { packaged: true, resourcesPath: undefined, appPath: '/repo' },
      '/repo/src/packages/pilot/build/bin'
    ]
  ])('%s', (_name, opts, dir) => {
    expect(pilotBinDir(opts)).toBe(dir)
  })
})

describe('resolveEngineEnv', () => {
  it.each([
    ['given', env, env],
    ['undefined (orcad)', undefined, { binDir: '', dataDir: '/data/orcad' }]
  ])('%s', (_name, given, expected) => {
    expect(resolveEngineEnv(given, '/data/orcad')).toEqual(expected)
  })
})
