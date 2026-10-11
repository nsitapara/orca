import type { ItemKind } from '../../shared/definition/types'
import { mergeRequestSource } from './merge-requests'
import type { ItemSource } from './types'

// Each item kind's source. Tasks 15–17 add worktree, pipeline and linear_ticket here.
const SOURCES: Partial<Record<ItemKind, ItemSource>> = { merge_request: mergeRequestSource }

const KIND_NAMES: Record<ItemKind, string> = {
  merge_request: 'merge requests',
  worktree: 'worktree items',
  pipeline: 'pipelines',
  linear_ticket: 'Linear tickets'
}

export function itemSource(kind: ItemKind): ItemSource {
  const source = SOURCES[kind]
  if (!source) {
    throw new Error(`Pilot can't list ${KIND_NAMES[kind]} yet`)
  }
  return source
}
