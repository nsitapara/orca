import type { HoldDeps } from '../holds'

// The holds' looks for tests: the worktree exists and nothing goes on in it. Spread it and change one look.
export const FREE_HOLDS: HoldDeps = {
  exists: () => true,
  inFlight: async () => null,
  activity: async () => null,
  runsIn: () => []
}
