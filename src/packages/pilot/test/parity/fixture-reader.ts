import { join } from 'node:path'
import { applyImport } from '../../src/main/importer/sweep-state/apply'
import type {
  StateReader,
  StateWorktree,
  SweepStateMapper
} from '../../src/main/importer/sweep-state/types'
import type { PilotStore } from '../../src/main/store/store'
import { stdoutOf, type ParityFixture } from './fixture'

// The old notes of a job, kept in the case's state as `<loop>/vault.json` ({ notes: { "<job folder>/<note>.md": text } }).
function vaultNotes(f: ParityFixture): Record<string, string> {
  const notes: Record<string, string> = {}
  for (const [key, value] of Object.entries(f.state)) {
    if (key.endsWith('/vault.json')) {
      Object.assign(notes, (value as { notes?: Record<string, string> }).notes ?? {})
    }
  }
  return notes
}

// The worktrees the old side's `orca worktree list` read saw, as the runtime's listing gives them to a mapper.
function listedWorktrees(f: ParityFixture): StateWorktree[] {
  const read = f.reads.find((r) => r.argv.join(' ') === 'orca worktree list --json')
  if (!read) {
    return []
  }
  type Listed = { id: string; path: string; branch?: string; repoId: string; isArchived?: boolean }
  const listed = (JSON.parse(stdoutOf(read)) as { result: { worktrees: Listed[] } }).result
    .worktrees
  return listed
    .filter((w) => w.repoId === f.repo.id && !w.isArchived)
    .map((w) => ({
      id: w.id,
      path: w.path,
      branch: w.branch ? w.branch.replace(/^refs\/heads\//, '') : null
    }))
}

// What a mapper test or a seed gives instead of a whole case: the state files, the job notes
// ("<job folder>/<note>.md" → text), the clock and the runtime's worktree listing.
export type StateInput = {
  state: Record<string, unknown>
  vault: Record<string, string>
  now: number
  worktrees: StateWorktree[]
}

function isFixture(input: ParityFixture | StateInput): input is ParityFixture {
  return 'reads' in input
}

// A parity case's `state` (files under agent-loops/) and job notes (under Agent Work/Automations/) as the importer's
// StateReader, so the engine side imports exactly what the old side reads. A StateInput gives those parts directly.
export function fixtureStateReader(
  input: ParityFixture | StateInput,
  dataDir = '/pilot-data'
): StateReader {
  const notes = isFixture(input) ? vaultNotes(input) : input.vault
  const worktrees = isFixture(input) ? listedWorktrees(input) : input.worktrees
  const { state, now } = input
  return {
    json: (rel) => (Object.hasOwn(state, rel) ? state[rel] : null),
    note: (rel) => notes[rel] ?? null,
    notes: (folder) =>
      Object.keys(notes)
        .filter((k) => k.startsWith(`${folder}/`) && k.endsWith('.md'))
        .map((k) => k.slice(folder.length + 1))
        .filter((name) => !name.includes('/'))
        .sort(),
    vaultPath: (rel) => join('/vault', rel),
    dataPath: (rel) => join(dataDir, rel),
    worktrees: () => worktrees,
    now
  }
}

// `seed` for dryTick: import the case's old state through the job's mapper, as `import-state --apply` would.
export function seedByImport(
  mapper: SweepStateMapper
): (store: PilotStore, f: ParityFixture) => void {
  return (store, f) => {
    applyImport(store, mapper.plan(fixtureStateReader(f)), f.now)
  }
}
