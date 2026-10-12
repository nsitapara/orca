import type { StateReader } from './types'

// A StateReader for mapper tests: everything reads as missing unless the test supplies it.
export function stateReader(parts: Partial<StateReader> = {}): StateReader {
  return {
    json: () => null,
    note: () => null,
    notes: () => [],
    vaultPath: (rel) => `/vault/${rel}`,
    dataPath: (rel) => `/data/${rel}`,
    worktrees: () => [],
    now: 0,
    ...parts
  }
}
