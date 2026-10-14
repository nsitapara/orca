import { z } from 'zod'
import type { ItemDecision } from '../../shared/api-types'
import type { AutomationDefinition, EnvWorkspaceDef } from '../../shared/definition/types'
import { envCreateArgs, resolveEnv, type ResolvedEnvWorkspace } from '../../shared/run/env-args'
import { runFields } from '../../shared/template'
import { mapLimit } from '../map-limit'
import type { RunStore } from '../store/store-runs'
import { holderOf, throwawayReason } from './hold'
import type { Pilotcli, PilotcliReply } from './pilotcli'

// A dry run's RPC is bounded (renderer RunControls LONG_CALL_MS, 180 s): four previews at a time, 30 s each.
export const PREVIEW_TIMEOUT_MS = 30_000
const AT_ONCE = 4
const dryResult = z.looseObject({
  mode: z.enum(['in_place', 'throwaway', 'kept']),
  reason: z.string().optional()
})

export type PreviewDeps = {
  runs: RunStore
  pilotcli: Pilotcli
  nameOf(automationId: string): string
  now(): number
}

function lineOf(reply: PilotcliReply): string {
  if (reply.outcome === 'not_yet') {
    return `would wait: ${reply.reason}`
  }
  if (reply.outcome !== 'ok') {
    return `workspace check ${reply.outcome}: ${reply.reason}`
  }
  const parsed = dryResult.safeParse(reply.data)
  if (!parsed.success) {
    return "workspace check: pilotcli's dry run didn't say where"
  }
  const reason = parsed.data.reason ?? ''
  if (parsed.data.mode === 'in_place') {
    return 'would run in place'
  }
  if (parsed.data.mode === 'kept') {
    return `would run in a kept worktree: ${reason}`
  }
  return `would run in a throwaway: ${reason}`
}

async function previewOne(
  deps: PreviewDeps,
  def: AutomationDefinition,
  ws: EnvWorkspaceDef,
  d: ItemDecision
): Promise<string> {
  const runId = `${def.id}-dry-run`
  const fields = {
    ...d.fields,
    ...runFields({ automationId: def.id, at: deps.now(), timezone: def.timezone, runId })
  }
  let env: ResolvedEnvWorkspace
  try {
    env = resolveEnv(ws, fields, d.label)
  } catch (error) {
    // resolveEnv's own words, as the real run would fail: "Can't prepare the workspace for <label>: {x} has no value", or
    // "stack resolved to '<value>', expected never|backend|full|when_backend".
    return error instanceof Error ? error.message : String(error)
  }
  const subject = env.subject
  // Read only: the dry run takes no claim, but says what a real run would pass.
  const holder =
    subject.kind === 'worktree' && subject.at === null
      ? holderOf(deps.runs, subject.worktree, runId)
      : null
  const throwaway = holder ? throwawayReason(holder, deps.nameOf) : null
  const args = envCreateArgs({ runId, env, throwaway, dryRun: true })
  return `${lineOf(await deps.pilotcli({ args, timeoutMs: PREVIEW_TIMEOUT_MS }))} · stack ${env.stack}`
}

// `pilot automations dry-run` and "Dry run all": each started item's `env create … --dry-run true`, which makes nothing.
export async function previewEnvs(
  deps: PreviewDeps,
  def: AutomationDefinition,
  decisions: ItemDecision[]
): Promise<void> {
  const ws = def.workspace
  if (ws.kind !== 'env') {
    return
  }
  const started = decisions.filter((d) => d.verdict === 'started')
  await mapLimit(started, AT_ONCE, async (d) => {
    const line = await previewOne(deps, def, ws, d)
    d.workspace = line
    d.reason = `${d.reason} · ${line}`
  })
}
