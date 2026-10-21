import type { InboxListRow, InboxType } from './api-types'

// The console's KIND_ORDER (worktree-gate/assets/answers.html).
export const KIND_ORDER: InboxType[] = [
  'question',
  'flagged',
  'action',
  'bug',
  'left_for_you',
  'default'
]

export type InboxGroup = {
  // Stable id of the group: the filter's value and the section's key.
  key: string
  label: string
  // For a worktree group: the app's worktree id when an item key named it (`wt:<id>`); else looked up by path.
  worktreeId?: string
  // Section order: worktrees, MRs, pipelines, tickets, jobs, then Clean up.
  rank: number
}
export type GroupableItem = Pick<InboxListRow, 'itemKey' | 'worktreePath' | 'automationId'> & {
  itemLabel?: string
}
export type Section<T extends InboxListRow = InboxListRow> = { group: InboxGroup; items: T[] }

const RANK = { worktree: 0, mr: 1, pipeline: 2, ticket: 3, job: 4, cleanup: 5 } as const
const CLEAN_UP = new Set(['docker-prune'])
const DEV_PIPELINE = 'dev'

// A group that says where a card's work is (worktree, MR, pipeline, ticket), not which job made it.
export function isPlaceGroup(group: InboxGroup): boolean {
  return group.rank < RANK.job
}

function folderName(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.split('/').at(-1) || trimmed
}

function worktreeGroup(path: string, worktreeId?: string): InboxGroup {
  const trimmed = path.replace(/\/+$/, '')
  const group = { key: `wt:${trimmed}`, label: folderName(trimmed), rank: RANK.worktree }
  return worktreeId ? { ...group, worktreeId } : group
}

// The path in a `wt:<repoId>::<path>` item key, or null when the key is not that shape.
function wtPathOf(key: string): string | null {
  if (!key.startsWith('wt:')) {
    return null
  }
  const at = key.indexOf('::')
  const path = at === -1 ? '' : key.slice(at + 2).trim()
  return path.replace(/\/+$/, '') === '' ? null : path
}

function after(key: string, prefix: string): string | null {
  if (!key.startsWith(prefix)) {
    return null
  }
  const rest = key.slice(prefix.length).trim()
  return rest === '' ? null : rest
}

// "!<iid> · <branch or title>": the item's label with a leading "!<iid> " dropped so it isn't said twice.
function mrLabel(iid: string, itemLabel: string | undefined): string {
  const name = (itemLabel ?? '')
    .trim()
    .replace(new RegExp(`^!${iid}\\b\\s*(?:·\\s*)?`), '')
    .trim()
  return name ? `!${iid} · ${name}` : `!${iid}`
}

// A pipeline key is `pipeline:<id>`; one that names a ref (not a number) is that ref's pipeline.
function pipelineGroup(rest: string): InboxGroup {
  const ref = /^\d+$/.test(rest) ? DEV_PIPELINE : rest
  return { key: `pipeline:${ref}`, label: `${ref} pipeline`, rank: RANK.pipeline }
}

function jobGroup(automationId: string, automations: { id: string; name: string }[]): InboxGroup {
  if (CLEAN_UP.has(automationId)) {
    return { key: 'cleanup', label: 'Clean up', rank: RANK.cleanup }
  }
  const name = automations.find((a) => a.id === automationId)?.name
  return { key: `job:${automationId}`, label: name || automationId, rank: RANK.job }
}

// Which section a card belongs to: its worktree; the worktree in its item key; its MR (or the worktree another
// card of that MR is known to have); its pipeline; its ticket; else its job. A malformed key falls through.
// `mrWorktrees` maps an `mr:<iid>` key to a worktree path already known from the other cards.
export function groupOf(
  item: GroupableItem,
  automations: { id: string; name: string }[],
  mrWorktrees: ReadonlyMap<string, string> = new Map()
): InboxGroup {
  if (item.worktreePath) {
    return worktreeGroup(item.worktreePath)
  }
  const key = item.itemKey ?? ''
  const wt = wtPathOf(key)
  if (wt) {
    return worktreeGroup(wt, key.slice('wt:'.length))
  }
  const iid = after(key, 'mr:')
  if (iid) {
    const known = mrWorktrees.get(key)
    return known
      ? worktreeGroup(known)
      : { key: `mr:${iid}`, label: mrLabel(iid, item.itemLabel), rank: RANK.mr }
  }
  const pipeline = after(key, 'pipeline:')
  if (pipeline) {
    return pipelineGroup(pipeline)
  }
  const ticket = after(key, 'linear:')
  if (ticket) {
    return { key: `linear:${ticket}`, label: ticket, rank: RANK.ticket }
  }
  return jobGroup(item.automationId, automations)
}

function kindRank(type: InboxType): number {
  const at = KIND_ORDER.indexOf(type)
  return at === -1 ? KIND_ORDER.length : at
}

export function byCard(a: InboxListRow, b: InboxListRow): number {
  return (
    kindRank(a.type) - kindRank(b.type) || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  )
}

export function compareGroups(a: InboxGroup, b: InboxGroup): number {
  return a.rank - b.rank || a.label.localeCompare(b.label, undefined, { numeric: true })
}

// Every card in exactly one section, sections in order, cards in the console's order inside each.
export function groupItems<T extends InboxListRow>(
  items: readonly T[],
  automations: { id: string; name: string }[]
): Section<T>[] {
  const mrWorktrees = new Map<string, string>()
  for (const i of items) {
    if (i.worktreePath && i.itemKey?.startsWith('mr:')) {
      mrWorktrees.set(i.itemKey, i.worktreePath)
    }
  }
  const sections = new Map<string, Section<T>>()
  for (const item of items) {
    const group = groupOf(item, automations, mrWorktrees)
    const section = sections.get(group.key) ?? { group, items: [] }
    if (group.worktreeId && !section.group.worktreeId) {
      section.group = { ...section.group, worktreeId: group.worktreeId }
    }
    // The first card of an MR group that has a name gives the group its name.
    if (
      group.rank === RANK.mr &&
      section.items.length > 0 &&
      !section.group.label.includes(' · ')
    ) {
      section.group = group
    }
    section.items.push(item)
    sections.set(group.key, section)
  }
  return [...sections.values()]
    .map((s) => ({ group: s.group, items: s.items.sort(byCard) }))
    .sort((a, b) => compareGroups(a.group, b.group))
}
