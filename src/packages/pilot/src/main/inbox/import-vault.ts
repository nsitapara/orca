import { isSessionId } from '../../shared/session-id'
import { createHash } from 'node:crypto'
import type { InboxAnswer, InboxItemRow } from '../../shared/api-types'
import type { AgentKind, AutomationDefinition } from '../../shared/definition/types'
import type { InboxAddParams } from '../../shared/inbox-types'
import type { PeopleDirectory } from '../../shared/people'
import { oneLine } from './card'
import { SAME_CARD_OPEN } from './inbox-add'
import { splitCommand } from './split-command'
import type { VaultRow } from './vault-reader'

// act.py script → Pilot catalog entry (the bridged entries of Task 22a).
export const SCRIPT_ENTRIES: Record<string, string> = {
  push: 'push',
  'mark-ready': 'mark_ready',
  'post-review': 'post_review'
}

const MAX_ANSWER_CHARS = 4000

export type ImportContext = {
  definitions: AutomationDefinition[]
  people: PeopleDirectory
  // Worktree id by path, for worktree-kind automations' item keys.
  worktreeIds: Map<string, string>
  existing(id: string): boolean
  // An imported card that may still get its bundle (isBackfillable); absent: none may.
  backfillable?(id: string): boolean
  now: number
}
export type ImportRun = {
  id: string
  automationId: string
  itemKey: string
  itemLabel: string
  worktreePath: string | null
  startedAt: number
  agent: AgentKind
  sessionId: string
}
export type PlannedItem = {
  id: string
  vaultRef: string
  automationId: string
  itemKey: string | null
  worktreePath: string | null
  type: VaultRow['kind']
  title: string
  // What goes through addInboxItem (the engine's own validation, routing and size rules).
  params: InboxAddParams
  // The same card named by automation and item, for a dry run (the run it would belong to isn't there yet).
  plain: InboxAddParams
  runId: string | null
  answer: {
    text: string
    option: number | null
    via: Extract<InboxAnswer['via'], 'page' | 'import'>
    // apply.py already sent it to a session.
    sent: boolean
  } | null
}
// A card the import wrote before it carried bundles, and the bundle its vault item names.
export type PlannedBackfill = { id: string; vaultRef: string; title: string; path: string }
export type ImportPlan = {
  items: PlannedItem[]
  // Existing open, unanswered cards without a bundle whose vault item names one (the backfill).
  backfill: PlannedBackfill[]
  runs: ImportRun[]
  skipped: { note: string; key: string; summary: string; reason: string }[]
  notes: { id: string; note: string }[]
}
export type ImportReport = {
  applied: boolean
  imported: number
  answers: number
  runs: number
  // Cards already imported that got (or would get) their bundle.
  backfilled: number
  // New cards imported with their bundle, plus the backfilled ones.
  details: number
  skipped: ImportPlan['skipped']
  notes: ImportPlan['notes']
}

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

export function vaultItemId(note: string, key: string): string {
  return `in_${sha(`vault|${note}|${key}`).slice(0, 16)}`
}

// Only a card nobody has answered, still open and without a bundle, gets one from the import: an answer
// was given to what the card showed, and a card with a bundle keeps it (the import stays idempotent).
export function isBackfillable(item: InboxItemRow | null): boolean {
  return (
    item !== null &&
    item.status === 'open' &&
    item.answer === null &&
    item.answeredAt === null &&
    item.details === null
  )
}

function automationFor(row: VaultRow, defs: AutomationDefinition[]): AutomationDefinition | null {
  return defs.find((d) => row.job === d.name || row.job.endsWith(` · ${d.name}`)) ?? null
}

function itemKeyOf(
  row: VaultRow,
  def: AutomationDefinition,
  worktreeIds: Map<string, string>
): string | null {
  if (def.items?.kind === 'merge_request' && row.mr_iid) {
    return `mr:${row.mr_iid}`
  }
  const id = row.worktree ? worktreeIds.get(row.worktree) : undefined
  if (def.items?.kind === 'worktree' && id) {
    return `wt:${id}`
  }
  return null
}

type ActionPin = {
  action: string | null
  args: Record<string, unknown> | null
  note: string | null
}

function actionOf(row: VaultRow): ActionPin {
  if (!row.run_command) {
    const perPart = row.parts.some((p) => p.run)
    const note = perPart
      ? 'its parts each carry a command, which Pilot does not run: Approve goes to the agent'
      : null
    return { action: null, args: null, note }
  }
  const [script, ...argv] = splitCommand(row.run_command)
  const entry = SCRIPT_ENTRIES[script]
  if (!entry) {
    return {
      action: null,
      args: null,
      note: `${script} isn't in Pilot's catalog: Approve goes to the agent`
    }
  }
  return { action: entry, args: { argv }, note: null }
}

// A Resume: line is note text agents can write, and the dispatcher resumes whatever session id lands here:
// only a session id (shared/session-id.ts) counts.

function runOf(
  row: VaultRow,
  def: AutomationDefinition,
  itemKey: string | null,
  now: number
): ImportRun | null {
  if (!isSessionId(row.session)) {
    return null
  }
  return {
    id: `import-${sha(`${def.id}|${row.note}|${row.asked_in}|${row.section_time}`).slice(0, 12)}`,
    automationId: def.id,
    itemKey: itemKey ?? `repo:${def.repo}`,
    itemLabel: row.mr_iid ? `!${row.mr_iid} ${row.branch}` : row.location || def.name,
    worktreePath: row.scope === 'branch' ? row.worktree : null,
    startedAt: Date.parse(row.created_at ?? '') || now,
    agent: row.resume.startsWith('codex') ? 'codex' : 'claude',
    sessionId: row.session
  }
}

type CardTarget = Pick<
  InboxAddParams,
  'runId' | 'stepIdx' | 'automationId' | 'itemKey' | 'worktreePath'
>

// In a run the card's automation, item and worktree come from the run alone; otherwise they are named,
// with the worktree only for a branch-scoped card that names one.
function targetOf(
  row: VaultRow,
  run: ImportRun | null,
  def: AutomationDefinition,
  itemKey: string | null
): CardTarget {
  if (run) {
    return { runId: run.id, stepIdx: 0 }
  }
  const named: CardTarget = { automationId: def.id, itemKey: itemKey ?? `repo:${def.repo}` }
  if (row.scope === 'branch' && row.worktree) {
    named.worktreePath = row.worktree
  }
  return named
}

function paramsOf(
  row: VaultRow,
  action: ActionPin,
  run: ImportRun | null,
  def: AutomationDefinition,
  itemKey: string | null
): InboxAddParams {
  return {
    ...targetOf(row, run, def, itemKey),
    type: row.kind,
    title: row.summary,
    context: row.context,
    suggested: row.suggested,
    options: row.options.map((o) => (o.description ? `${o.label} — ${o.description}` : o.label)),
    // The bundle itself (Pilot reads and checks it); a refused one falls back to a line (import-apply.ts).
    detailsBundlePath: row.details_path || undefined,
    action: action.action ?? undefined,
    actionArgs: action.args ?? undefined,
    parts: Object.fromEntries(row.parts.map((p) => [p.id, p.label])),
    // The switch words, on then off (R-3).
    switchWords: row.switch.length === 2 ? row.switch : undefined
  }
}

function answerOf(row: VaultRow): PlannedItem['answer'] {
  const text = oneLine(row.answer).slice(0, MAX_ANSWER_CHARS)
  if (!text) {
    return null
  }
  const at = row.options.findIndex((o) => o.label.trim().toLowerCase() === text.toLowerCase())
  // Only a page save of this exact card version approved it (apply.py bind); the route still re-asks an
  // approval, since an import names no caller kind (Group 23).
  const via = row.bound && row.bound === row.digest ? ('page' as const) : ('import' as const)
  return { text, option: at === -1 ? null : at, via, sent: row.status === 'applying' }
}

export function planVaultImport(rows: VaultRow[], ctx: ImportContext): ImportPlan {
  const plan: ImportPlan = { items: [], backfill: [], runs: [], skipped: [], notes: [] }
  const runs = new Map<string, ImportRun>()
  const seen = new Set<string>()
  for (const row of rows) {
    const id = vaultItemId(row.note, row.key)
    const skip = (reason: string) =>
      plan.skipped.push({ note: row.note, key: row.key, summary: row.summary, reason })
    const def = automationFor(row, ctx.definitions)
    if (!def) {
      skip(`no Pilot automation is named after "${row.job}"`)
      continue
    }
    if (ctx.existing(id)) {
      if (row.details_path && ctx.backfillable?.(id)) {
        const vaultRef = `${row.note}#${row.key}`
        plan.backfill.push({ id, vaultRef, title: oneLine(row.summary), path: row.details_path })
      } else {
        skip('already imported')
      }
      continue
    }
    const itemKey = itemKeyOf(row, def, ctx.worktreeIds)
    const action = actionOf(row)
    const run = runOf(row, def, itemKey, ctx.now)
    const params = paramsOf(row, action, run, def, itemKey)
    const plain = run ? paramsOf(row, action, null, def, itemKey) : params
    const same = `${def.id}|${plain.itemKey}|${row.kind}|${oneLine(row.summary)}`
    if (seen.has(same)) {
      skip(SAME_CARD_OPEN)
      continue
    }
    seen.add(same)
    if (run && !runs.has(run.id)) {
      runs.set(run.id, run)
    }
    plan.items.push({
      id,
      vaultRef: `${row.note}#${row.key}`,
      automationId: def.id,
      itemKey: run?.itemKey ?? itemKey,
      worktreePath: row.scope === 'branch' ? row.worktree : null,
      type: row.kind,
      title: oneLine(row.summary),
      params,
      plain: run ? { ...plain, worktreePath: undefined } : plain,
      runId: run?.id ?? null,
      answer: answerOf(row)
    })
    if (action.note) {
      plan.notes.push({ id, note: action.note })
    }
  }
  plan.runs = [...runs.values()]
  return plan
}

export function reportOf(
  plan: ImportPlan,
  applied: boolean,
  runs = plan.runs.length,
  counts: Pick<ImportReport, 'backfilled' | 'details'> = { backfilled: 0, details: 0 }
): ImportReport {
  return {
    applied,
    imported: plan.items.length,
    answers: plan.items.filter((i) => i.answer).length,
    runs,
    ...counts,
    skipped: plan.skipped,
    notes: plan.notes
  }
}
