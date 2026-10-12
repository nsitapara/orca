import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { InboxAddParams } from '../../shared/inbox-types'
import { addInboxItem } from '../inbox/inbox-add'
import {
  getInboxItem,
  listInbox,
  replyToInboxItem,
  resolveInboxItem,
  type InboxDeps
} from '../inbox/inbox-service'
import type { PilotContext } from '../pilot-services'
import { resolveChannelRun, resolveChannelStep } from './run-channel'

const TYPES = ['question', 'flagged', 'default', 'action', 'bug', 'left_for_you'] as const
const STATUSES = ['open', 'answered', 'done', 'obsolete', 'stale', 'dismissed'] as const
const text = (max: number) => z.string().max(max)

export const InboxAdd = z.object({
  terminal: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  stepIdx: z.number().int().nonnegative().optional(),
  automationId: z.string().min(1).optional(),
  itemKey: z.string().min(1).optional(),
  type: z.enum(TYPES),
  title: z.string().min(1).max(500),
  context: text(8000).optional(),
  suggested: text(500).optional(),
  options: z.array(text(500)).max(10).optional(),
  detailsMd: text(64 * 1024).optional(),
  action: z.string().min(1).max(64).optional(),
  actionArgs: z.record(z.string(), z.unknown()).optional(),
  parts: z.record(z.string().min(1).max(64), text(500)).optional(),
  // The switch words, on then off (R-3).
  switchWords: z.array(z.string().min(1).max(40)).length(2).optional(),
  worktreePath: z.string().min(1).optional()
})
const Id = z.object({ id: z.string().min(1) })
const List = z.object({
  person: z.string().min(1).optional(),
  statuses: z.array(z.enum(STATUSES)).optional()
})
const Tick = Id.extend({ outcome: z.string().min(1).max(2000) })
const Reply = Id.extend({ text: z.string().min(1).max(4000) })

export function inboxDeps(c: PilotContext): InboxDeps {
  return {
    store: c.store,
    now: Date.now,
    definitions: () => c.loaded().definitions,
    people: () => c.loaded().people
  }
}

// Which run (and step) a card belongs to: the step running on the caller's terminal first, the env's step
// only as the fallback (ruling 8d, run-channel's resolver). With no terminal-bound step and no env run,
// an explicit --automation and --item still files a job-wide card; otherwise the resolver refuses.
// Whenever a run is resolved, the card's automation, item and worktree come from that run alone.
export function resolveAddTarget(c: PilotContext, p: z.infer<typeof InboxAdd>): InboxAddParams {
  const { terminal, ...card } = p
  const explicit = card.automationId !== undefined && card.itemKey !== undefined
  if (terminal === undefined && card.runId === undefined) {
    return card
  }
  if (
    card.runId === undefined &&
    explicit &&
    c.store.runs.stepsOnTerminal(terminal ?? '').length === 0
  ) {
    return card
  }
  const fromRunOnly = {
    ...card,
    automationId: undefined,
    itemKey: undefined,
    worktreePath: undefined
  }
  if (terminal === undefined && card.stepIdx === undefined) {
    return { ...fromRunOnly, runId: resolveChannelRun(c, card) }
  }
  const { runId, stepIdx } = resolveChannelStep(c, {
    terminal,
    runId: card.runId,
    stepIdx: card.stepIdx
  })
  return { ...fromRunOnly, runId, stepIdx }
}

export function buildInboxMethods(ctx: () => PilotContext) {
  return [
    defineMethod({
      name: 'pilot.inbox.add',
      permission: 'workspace',
      params: InboxAdd,
      handler: (p) => {
        const c = ctx()
        return addInboxItem(inboxDeps(c), resolveAddTarget(c, p))
      }
    }),
    defineMethod({
      name: 'pilot.inbox.list',
      permission: 'workspace',
      params: List,
      handler: (p) => listInbox(inboxDeps(ctx()), p)
    }),
    defineMethod({
      name: 'pilot.inbox.get',
      permission: 'workspace',
      params: Id,
      handler: (p) => getInboxItem(inboxDeps(ctx()), p.id)
    }),
    defineMethod({
      name: 'pilot.inbox.tick',
      permission: 'workspace',
      params: Tick,
      handler: (p) => resolveInboxItem(inboxDeps(ctx()), p.id, p.outcome)
    }),
    defineMethod({
      name: 'pilot.inbox.reply',
      permission: 'workspace',
      params: Reply,
      handler: (p) => replyToInboxItem(inboxDeps(ctx()), p.id, p.text)
    })
  ]
}
