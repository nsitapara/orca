import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import { attemptAction, type AttemptDeps, type AttemptResult } from '../actions/attempt'
import type { PilotContext } from '../pilot-services'
import { inboxDeps } from './methods-inbox'
import { resolveChannelStep } from './run-channel'

export const MAX_ACTION_ARGS = 64 * 1024

const ActionRun = z.object({
  action: z.string().min(1).max(64),
  args: z
    .record(z.string(), z.unknown())
    .refine((a) => JSON.stringify(a).length <= MAX_ACTION_ARGS, 'The args are over 64 KB'),
  dryRun: z.boolean().optional(),
  // Where the call comes from: the CLI's terminal handle, and the env's step as the fallback (ruling 8d).
  terminal: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  stepIdx: z.number().int().nonnegative().optional()
})

export function attemptDeps(c: PilotContext): AttemptDeps {
  return {
    store: c.store,
    now: Date.now,
    catalog: c.actions,
    definitions: () => c.loaded().definitions,
    inbox: inboxDeps(c)
  }
}

export const NO_CALLER = "Pilot can't tell who is calling; nothing runs"

// A person's own approval comes only from what the transport proved (rpc-caller-identity.ts): Pilot's
// desktop app or a paired device. Never from params, and never for the local CLI, which agents use too.
function personCalling(caller: RpcCallerIdentity | undefined): boolean {
  return caller?.kind === 'desktop' || caller?.kind === 'paired-device'
}

// Whose powers apply to a local CLI caller (Task 22b ruling): the step starting or running on its terminal,
// else the env's PILOT_RUN_ID/PILOT_STEP_IDX only while that step is active in an open run (run-channel's
// resolver, which refuses anything else). With neither it is bound to no run (null), and approves nothing.
export function actionCaller(
  c: PilotContext,
  p: Pick<z.infer<typeof ActionRun>, 'terminal' | 'runId' | 'stepIdx'>
): { runId: string; stepIdx: number } | null {
  const bound = p.terminal ? c.store.runs.stepsOnTerminal(p.terminal) : []
  if (bound.length === 0 && p.runId === undefined && p.stepIdx === undefined) {
    return null
  }
  return resolveChannelStep(c, { terminal: p.terminal, runId: p.runId, stepIdx: p.stepIdx })
}

export function buildActionMethods(ctx: () => PilotContext) {
  return [
    defineMethod({
      name: 'pilot.action.run',
      permission: 'workspace',
      params: ActionRun,
      handler: async (p, rpc): Promise<AttemptResult> => {
        const c = ctx()
        const req = { action: p.action, args: p.args, dryRun: p.dryRun ?? false, inboxItemId: null }
        if (personCalling(rpc.caller)) {
          return attemptAction(attemptDeps(c), { ...req, runId: null, approved: true })
        }
        if (rpc.caller?.kind !== 'local-cli') {
          return { outcome: 'failed', detail: NO_CALLER, link: null, log: null, onYou: false }
        }
        // Bound: the run's powers apply. Unbound: only a dry run (attemptAction refuses the rest).
        const bound = actionCaller(c, p)
        return attemptAction(attemptDeps(c), {
          ...req,
          runId: bound?.runId ?? null,
          stepIdx: bound?.stepIdx ?? null,
          approved: false
        })
      }
    }),
    defineMethod({
      name: 'pilot.action.list',
      permission: 'workspace',
      params: null,
      handler: () =>
        ctx()
          .actions.entries()
          .map((e) => ({ name: e.name, power: e.power, label: e.label, usage: e.usage }))
    })
  ]
}
