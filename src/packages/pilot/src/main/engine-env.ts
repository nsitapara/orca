import { join } from 'node:path'

// Where Pilot's launchers live (`pilot`, `orca`) and its data folder. An empty binDir (orcad, which
// has no launcher folder) adds nothing to PATH.
export type EngineEnv = { binDir: string; dataDir: string }

const DEV_BIN = 'src/packages/pilot/build/bin'

// Packaged: Contents/Resources/bin. Dev (or no resources path): the repo's build/bin launchers.
export function pilotBinDir(opts: {
  packaged: boolean
  resourcesPath: string | undefined
  appPath: string
}): string {
  if (opts.packaged && typeof opts.resourcesPath === 'string') {
    return join(opts.resourcesPath, 'bin')
  }
  return join(opts.appPath, DEV_BIN)
}

// The environment of every process the engine spawns (field scripts, script checks, shell steps), so
// `orca` and `pilot` in a script reach Pilot's CLI and Pilot's data folder. The caller merges it onto
// the process environment. `extra` (the run env when in a run) is applied last.
export function engineChildEnv(
  env: EngineEnv,
  extra: Record<string, string> = {},
  base: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const dirs = [env.binDir, base.PATH ?? ''].filter((d) => d !== '')
  return { PATH: dirs.join(':'), ORCA_USER_DATA_PATH: env.dataDir, ...extra }
}

// orcad passes no EngineEnv: it has no launcher folder, so binDir is empty and its own data folder is used.
export function resolveEngineEnv(given: EngineEnv | undefined, dataDir: string): EngineEnv {
  return given ?? { binDir: '', dataDir }
}
