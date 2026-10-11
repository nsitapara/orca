import type { ItemFields } from '../../shared/api-types'
import type { Item, RepoFacts } from './types'

// repo.* (contract §4), on every item of a tick.
export function repoFields(repo: RepoFacts): ItemFields {
  return { 'repo.name': repo.name, 'repo.path': repo.path, 'repo.base': repo.base }
}

// A run-once automation's one item: the repo (contract §3). It has no worktree of its own; the
// workspace (the main checkout, or a new worktree) decides where its run goes.
export function runOnceItem(repo: RepoFacts): Item {
  return {
    kind: 'repo',
    key: `repo:${repo.name}`,
    label: repo.name,
    fields: repoFields(repo),
    worktreeHint: null,
    sortKeys: { waitingSince: null, priority: null }
  }
}
