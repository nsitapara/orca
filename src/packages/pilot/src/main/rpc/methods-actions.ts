import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import { attemptAction, refuseCall, type AttemptDeps, type AttemptResult } from '../actions/attempt'
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Whose powers apply (Task 22b ruling): the step starting or running on the caller's terminal, else the
// env's PILOT_RUN_ID/PILOT_STEP_IDX only while that step is active in an open run (run-channel's resolver,
// which refuses anything else). With neither the call is bound to no run (null).
export function runBinding(
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
      // This method never approves anything, whoever calls: the transport's caller identity
      // (rpc-caller-identity.ts) is only required, never trusted further, since the CLI and runtime-scope
      // pairings share it with agents. A call bound to a run gets that run's powers (without the power its
      // person is asked, and nothing runs); an unbound call only dry-runs. A person approves on a card.
      handler: async (p, rpc): Promise<AttemptResult> => {
        const c = ctx()
        const deps = attemptDeps(c)
        const call = { action: p.action, args: p.args, dryRun: p.dryRun ?? false }
        if (!rpc.caller) {
          return refuseCall(deps, call, NO_CALLER)
        }
        let bound: { runId: string; stepIdx: number } | null
        try {
          bound = runBinding(c, p)
        } catch (error) {
          return refuseCall(deps, call, messageOf(error))
        }
        return attemptAction(deps, {
          ...call,
          runId: bound?.runId ?? null,
          stepIdx: bound?.stepIdx ?? null,
          inboxItemId: null,
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
