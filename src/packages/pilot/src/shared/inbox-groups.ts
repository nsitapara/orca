import type { InboxItemRow, InboxType } from './api-types'

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
  // Section order: worktrees, MRs, pipelines, tickets, jobs, then Clean up.
  rank: number
}
export type GroupableItem = Pick<InboxItemRow, 'itemKey' | 'worktreePath' | 'automationId'>
export type Section = { group: InboxGroup; items: InboxItemRow[] }

const RANK = { worktree: 0, mr: 1, pipeline: 2, ticket: 3, job: 4, cleanup: 5 } as const
const CLEAN_UP = new Set(['docker-prune', 'close-idle-sessions'])
const DEV_PIPELINE = 'dev'

function folderName(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.split('/').at(-1) || trimmed
}

function worktreeGroup(path: string): InboxGroup {
  const trimmed = path.replace(/\/+$/, '')
  return { key: `wt:${trimmed}`, label: folderName(trimmed), rank: RANK.worktree }
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
    return worktreeGroup(wt)
  }
  const iid = after(key, 'mr:')
  if (iid) {
    const known = mrWorktrees.get(key)
    return known ? worktreeGroup(known) : { key: `mr:${iid}`, label: `!${iid}`, rank: RANK.mr }
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

function byCard(a: InboxItemRow, b: InboxItemRow): number {
  return (
    kindRank(a.type) - kindRank(b.type) || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  )
}

function bySection(a: Section, b: Section): number {
  return (
    a.group.rank - b.group.rank ||
    a.group.label.localeCompare(b.group.label, undefined, { numeric: true })
  )
}

// Every card in exactly one section, sections in order, cards in the console's order inside each.
export function groupItems(
  items: InboxItemRow[],
  automations: { id: string; name: string }[]
): Section[] {
  const mrWorktrees = new Map<string, string>()
  for (const i of items) {
    if (i.worktreePath && i.itemKey?.startsWith('mr:')) {
      mrWorktrees.set(i.itemKey, i.worktreePath)
    }
  }
  const sections = new Map<string, Section>()
  for (const item of items) {
    const group = groupOf(item, automations, mrWorktrees)
    const section = sections.get(group.key) ?? { group, items: [] }
    section.items.push(item)
    sections.set(group.key, section)
  }
  return [...sections.values()]
    .map((s) => ({ group: s.group, items: s.items.sort(byCard) }))
    .sort(bySection)
}
