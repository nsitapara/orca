import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { StateReader, StateWorktree } from './types'

export type SweepStatePaths = { stateRoot: string; vaultAutomations: string; dataDir: string }
// What only the running app knows, read before the (synchronous) mapper runs.
export type LiveState = { worktrees: StateWorktree[]; now: number }

// The old sweeps' own folders (gate.STATE_ROOT and vault.AUTOMATIONS hardcode them); the environment
// overrides both, for tests and for trying an import against a copy.
export function sweepStatePaths(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env
): SweepStatePaths {
  const home = homedir()
  return {
    stateRoot:
      env.PILOT_SWEEP_STATE_ROOT || join(home, 'Documents', 'web-platform', '.git', 'agent-loops'),
    vaultAutomations:
      env.PILOT_VAULT_AUTOMATIONS ||
      join(home, 'Documents', 'WebPortal', 'Agent Work', 'Automations'),
    dataDir
  }
}

function readIfThere(file: string): string | null {
  if (!existsSync(file)) {
    return null
  }
  return readFileSync(file, 'utf8')
}

// Reads only: the old sweeps' files are never written, moved or deleted.
export function fsStateReader(
  paths: SweepStatePaths,
  live: LiveState = { worktrees: [], now: Date.now() }
): StateReader {
  return {
    json(rel) {
      const file = join(paths.stateRoot, rel)
      const text = readIfThere(file)
      if (text === null) {
        return null
      }
      try {
        return JSON.parse(text)
      } catch (error) {
        throw new Error(`${file}: ${(error as Error).message}`)
      }
    },
    note: (rel) => readIfThere(join(paths.vaultAutomations, rel)),
    notes(folder) {
      const dir = join(paths.vaultAutomations, folder)
      if (!existsSync(dir)) {
        return []
      }
      return readdirSync(dir)
        .filter((name) => name.endsWith('.md'))
        .sort()
    },
    vaultPath: (rel) => join(paths.vaultAutomations, rel),
    dataPath: (rel) => join(paths.dataDir, rel),
    worktrees: () => live.worktrees,
    now: live.now
  }
}
