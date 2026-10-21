import type { ItemKind } from '../../shared/definition/types'
import { mergeRequestSource } from './merge-requests'
import { pipelineSource } from './pipelines'
import type { ItemSource } from './types'

// Each item kind's source. GitLab-only sources are built in. Sources that read the runtime or the
// store (worktrees, Linear tickets) register when Pilot starts (register-sources.ts, from openPilot).
const SOURCES: Partial<Record<ItemKind, ItemSource>> = {
  merge_request: mergeRequestSource(),
  pipeline: pipelineSource()
}

export function registerItemSource(source: ItemSource): void {
  SOURCES[source.kind] = source
}

const KIND_NAMES: Record<ItemKind, string> = {
  merge_request: 'merge requests',
  worktree: 'worktree items',
  pipeline: 'pipelines',
  linear_ticket: 'Linear tickets',
  inbox_preparation: 'inbox context requests',
  kept_branch: 'kept fixes'
}

export function itemSource(kind: ItemKind): ItemSource {
  const source = SOURCES[kind]
  if (!source) {
    throw new Error(`Pilot can't list ${KIND_NAMES[kind]} yet`)
  }
  return source
}
