import { basename } from 'node:path'
import {
  addImportedHandled,
  addImportedSession,
  type ImportedSession
} from '../../src/main/store/__fixtures__/imported-rows'
import type { PilotStore } from '../../src/main/store/store'
import { stdoutOf, type ParityFixture } from './fixture'

// What a parity seed reads from a case: the old sweep's state files (`<loop>/<file>` under agent-loops/), its notes
// and Orca's worktree listing. Each job's seed writes that state as Pilot keeps it, straight into the store.

export type ListedWorktree = { id: string; path: string; branch: string | null }

// The worktrees the old side's `orca worktree list` read saw: this repo's, not archived.
export function listedWorktrees(f: ParityFixture): ListedWorktree[] {
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

// A state file as an object: {} when the case has none.
export function stateObject(f: ParityFixture, rel: string): Record<string, unknown> {
  const value = f.state[rel]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

// The old notes of a job, kept in the case's state as `<loop>/vault.json` ({ notes: { "<job folder>/<note>.md": text } }).
export function vaultNotes(f: ParityFixture): Record<string, string> {
  const notes: Record<string, string> = {}
  for (const [key, value] of Object.entries(f.state)) {
    if (key.endsWith('/vault.json')) {
      Object.assign(notes, (value as { notes?: Record<string, string> }).notes ?? {})
    }
  }
  return notes
}

// A time the sweep saved as an ISO string, or the case's clock.
export function savedAt(f: ParityFixture, value: unknown): number {
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isNaN(at) ? f.now : at
}

const SHA = /^[0-9a-f]{40}$/

export function isSha(value: unknown): value is string {
  return typeof value === 'string' && SHA.test(value)
}

// A worktree sweep's seen.json, { "<worktree path>": "<sha>" }: each head it reviewed or tested is a done
// `<worktree id>@<sha>` key, so Pilot's marker starts there, and the worktree is seen. A path Orca no longer lists, or a
// value that isn't a sha, brings nothing.
export function seedSeenHeads(
  store: PilotStore,
  automationId: string,
  f: ParityFixture,
  rel: string
): void {
  const byPath = new Map(listedWorktrees(f).map((w) => [w.path, w]))
  for (const [path, sha] of Object.entries(stateObject(f, rel))) {
    const wt = byPath.get(path)
    if (wt && isSha(sha)) {
      addImportedHandled(store, automationId, [
        { onceKey: `${wt.id}@${sha}`, status: 'done', at: f.now }
      ])
      store.markSeen(automationId, `wt:${wt.id}`, f.now)
    }
  }
}

const TAB_FILES: { file: string; agent: ImportedSession['agent'] }[] = [
  { file: 'tabs.json', agent: 'claude' },
  { file: 'tabs-codex.json', agent: 'codex' }
]

// gate.tabs_file's { "<worktree path>": "<terminal handle>" } per agent: each tab the sweep opened is a finished
// imported run whose step names that terminal, for the session checks.
export function seedTabSessions(
  store: PilotStore,
  automationId: string,
  f: ParityFixture,
  loop: string
): void {
  for (const { file, agent } of TAB_FILES) {
    for (const [path, handle] of Object.entries(stateObject(f, `${loop}/${file}`))) {
      if (typeof handle === 'string' && handle.length > 0) {
        addImportedSession(
          store,
          automationId,
          { worktreePath: path, terminalHandle: handle, agent, label: basename(path) },
          f.now
        )
      }
    }
  }
}
