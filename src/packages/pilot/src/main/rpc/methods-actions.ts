import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import { attemptAction, type AttemptDeps } from '../actions/attempt'
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

// Whose powers apply (Task 22b ruling): the step starting or running on the caller's terminal, else the
// env's PILOT_RUN_ID/PILOT_STEP_IDX only while that step is active in an open run (run-channel's resolver,
// which refuses anything else). A caller with neither, no Pilot step on its terminal and no run in its
// env, is a person acting on their own approval: null.
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
      handler: (p) => {
        const c = ctx()
        const caller = actionCaller(c, p)
        return attemptAction(attemptDeps(c), {
          action: p.action,
          args: p.args,
          dryRun: p.dryRun ?? false,
          runId: caller?.runId ?? null,
          stepIdx: caller?.stepIdx ?? null,
          inboxItemId: null,
          approved: caller === null
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
