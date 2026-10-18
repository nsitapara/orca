import type { PreparationInput } from '../../shared/preparation'
import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { InboxAddParams } from '../../shared/inbox-types'
import { proposalProblem } from '../actions/powers'
import { shownItem } from '../answers/draft-grant'
import { DETAILS_EITHER } from '../inbox/card'
import { addInboxItem } from '../inbox/inbox-add'
import { cardRunLine } from '../inbox/run-line'
import {
  buildInboxDeps,
  getInboxItem,
  listInbox,
  replyToInboxItem,
  resolveInboxItem,
  type InboxDeps
} from '../inbox/inbox-service'
import type { PilotContext } from '../pilot-services'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import { refuseOutsideScope } from './details-scope'
import { runBinding, type CallBinding } from './run-binding'
import { resolveChannelRun, resolveChannelStep } from './run-channel'

const TYPES = ['question', 'flagged', 'default', 'action', 'bug', 'left_for_you'] as const
const STATUSES = ['open', 'answered', 'done', 'obsolete', 'stale', 'dismissed'] as const
const text = (max: number) => z.string().max(max)

export const InboxAdd = z
  .object({
    terminal: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    stepIdx: z.number().int().nonnegative().optional(),
    automationId: z.string().min(1).optional(),
    itemKey: z.string().min(1).optional(),
    // Checked by addInboxItem, so its refusal carries PREPARATION_REFUSED (the bridge's D2 fallback reads it).
    preparation: z.custom<PreparationInput>((v) => typeof v === 'object' && v !== null).optional(),
    notPrepared: z
      .object({ key: z.string().trim().min(1).max(500), reason: z.string().min(1).max(2000) })
      .strict()
      .optional(),
    type: z.enum(TYPES),
    title: z.string().min(1).max(500),
    context: text(8000).optional(),
    suggested: text(500).optional(),
    options: z.array(text(500)).max(10).optional(),
    detailsMd: text(64 * 1024).optional(),
    // Read by this process from inside the Automations folder (ruling 1): the CLI never sends its bytes.
    detailsBundlePath: z.string().min(1).max(4096).optional(),
    action: z.string().min(1).max(64).optional(),
    actionArgs: z.record(z.string(), z.unknown()).optional(),
    worktreePath: z.string().min(1).optional()
  })
  .refine((p) => p.detailsMd === undefined || p.detailsBundlePath === undefined, DETAILS_EITHER)
const Id = z.object({ id: z.string().min(1) })
const List = z.object({
  person: z.string().min(1).optional(),
  statuses: z.array(z.enum(STATUSES)).optional()
})
const Tick = Id.extend({ outcome: z.string().min(1).max(2000) })
// The run binding is the CLI's terminal and env step (never trusted from a paired device or the desktop).
const Reply = Id.extend({
  text: z.string().min(1).max(4000),
  terminal: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  stepIdx: z.number().int().nonnegative().optional()
})

// The run a reply comes from: only a local CLI call bound to a run of a Pilot step has one. A binding that
// can't be resolved is no run at all.
function replyingRun(
  c: PilotContext,
  caller: RpcCallerIdentity | undefined,
  p: CallBinding
): string | null {
  if (caller?.kind !== 'local-cli') {
    return null
  }
  try {
    return runBinding(c, p)?.runId ?? null
  } catch {
    return null
  }
}

// A card an RPC call closes leaves its run alone (onResolved null): only the scheduler's tick and answers
// pass cancel an ask-first run whose card closed, in the process that runs the engine.
export function inboxDeps(c: PilotContext): InboxDeps {
  return buildInboxDeps({
    store: c.store,
    now: Date.now,
    definitions: () => c.loaded().definitions,
    people: () => c.loaded().people,
    actions: c.actions,
    onResolved: null,
    detailsRoot: c.detailsRoot ?? null
  })
}

// What a step (or a job-wide caller) files is a proposal: its action must be in the catalog, its args must
// fit, and the filing automation (a run's card: the run's) must have the action's power. Pilot's own asks
// (a run lacking the power, ask_first) don't come through here.
function refuseUnproposable(c: PilotContext, target: InboxAddParams): void {
  if (!target.action) {
    return
  }
  const automationId = target.runId
    ? c.store.runs.get(target.runId)?.automationId
    : target.automationId
  const def = c.loaded().definitions.find((d) => d.id === automationId)
  if (!def) {
    throw new Error(`No automation "${automationId ?? ''}"`)
  }
  const problem = proposalProblem(c.actions, def, target.action, target.actionArgs ?? {})
  if (problem) {
    throw new Error(problem)
  }
}

// The automation whose card an add is: the resolved run's, else the one it names.
function targetAutomation(c: PilotContext, target: InboxAddParams): string {
  if (target.runId) {
    return c.store.runs.get(target.runId)?.automationId ?? ''
  }
  return target.automationId ?? ''
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
      handler: (p, rpc) => {
        const c = ctx()
        const target = resolveAddTarget(c, p)
        refuseUnproposable(c, target)
        // A bundle can change an open card and clear its answer: only a caller in scope may give one, and the
        // card's own answer run may re-add it while it applies the answer.
        let callerRunId: string | null = null
        if (target.detailsBundlePath !== undefined) {
          callerRunId = refuseOutsideScope(c, rpc.caller, p, targetAutomation(c, target))
        }
        return addInboxItem(inboxDeps(c), target, { callerRunId })
      }
    }),
    defineMethod({
      name: 'pilot.inbox.list',
      permission: 'workspace',
      params: List,
      handler: (p) => {
        const c = ctx()
        return listInbox(inboxDeps(c), p, (item) => cardRunLine(c.actions, item))
      }
    }),
    defineMethod({
      name: 'pilot.inbox.get',
      permission: 'workspace',
      params: Id,
      // `pilot inbox show`: the card, its Details ref carrying whether the current answer grants the drafted patch.
      handler: (p) => shownItem(getInboxItem(inboxDeps(ctx()), p.id))
    }),
    defineMethod({
      name: 'pilot.inbox.tick',
      permission: 'workspace',
      params: Tick,
      handler: (p) => {
        const deps = inboxDeps(ctx())
        // An ask-first card is a person's Approve or Skip in Pilot; closing it from here would be a skip
        // no one chose (the key stays handled).
        if (getInboxItem(deps, p.id).action === 'start_run') {
          throw new Error('Answer this in Pilot (Inbox)')
        }
        return resolveInboxItem(deps, p.id, p.outcome)
      }
    }),
    defineMethod({
      name: 'pilot.inbox.reply',
      permission: 'workspace',
      params: Reply,
      handler: (p, rpc) => {
        const c = ctx()
        return replyToInboxItem(inboxDeps(c), p.id, p.text, replyingRun(c, rpc?.caller, p))
      }
    })
  ]
}
