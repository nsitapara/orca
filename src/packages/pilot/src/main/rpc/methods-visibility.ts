import { z } from 'zod'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import type { PilotContext } from '../pilot-services'
import { acknowledgeRuns, doneForYou } from '../transcript/done-for-you'
import { LogReader } from '../transcript/log-file'
import { RunEffectsReader } from '../transcript/run-effects'
import { stepLog, stepLogEntry, type StepLogDeps } from '../transcript/step-log'
import { defaultUsagePaths } from '../usage/step-usage'

export const LOG_BY_PERSON = "A step's log opens from Pilot's window or a paired device"
const MAX_EFFECT_RUNS = 300

export type VisibilityReaders = { log: StepLogDeps; effects: RunEffectsReader }

const StepRef = z.object({ runId: z.string().min(1), stepIdx: z.number().int().nonnegative() })
const EntryRef = StepRef.extend({ id: z.string().min(1) })
const RunIds = z.object({ runIds: z.array(z.string().min(1)).max(MAX_EFFECT_RUNS) })

// A transcript can hold ticket and comment text: only Nish, at Pilot's window or a paired device, reads it.
function requirePerson(caller: RpcCallerIdentity | undefined): RpcCallerIdentity['kind'] {
  if (caller?.kind !== 'desktop' && caller?.kind !== 'paired-device') {
    throw new Error(LOG_BY_PERSON)
  }
  return caller.kind
}

// One reader of transcripts per process, made on first use (Pilot's context isn't there before it starts).
function lazyReaders(ctx: () => PilotContext): () => VisibilityReaders {
  let made: VisibilityReaders | null = null
  return () => {
    if (!made) {
      const log = {
        store: ctx().store,
        reader: new LogReader(defaultUsagePaths().claudeProjects),
        claudeProjects: defaultUsagePaths().claudeProjects
      }
      made = { log, effects: new RunEffectsReader(log) }
    }
    return made
  }
}

// A step's log, one log entry, and runs' effects (Run visibility spec §1, §2).
export function buildVisibilityMethods(
  ctx: () => PilotContext,
  readers: () => VisibilityReaders = lazyReaders(ctx)
) {
  return [
    defineMethod({
      name: 'pilot.runs.log',
      permission: 'workspace',
      params: StepRef,
      handler: (p, rpc) => {
        requirePerson(rpc.caller)
        return stepLog(readers().log, p.runId, p.stepIdx)
      }
    }),
    defineMethod({
      name: 'pilot.runs.logEntry',
      permission: 'workspace',
      params: EntryRef,
      handler: (p, rpc) => {
        requirePerson(rpc.caller)
        return stepLogEntry(readers().log, p.runId, p.stepIdx, p.id)
      }
    }),
    defineMethod({
      name: 'pilot.runs.effects',
      permission: 'workspace',
      params: RunIds,
      handler: (p) => readers().effects.forRuns(p.runIds)
    }),
    defineMethod({
      name: 'pilot.runs.doneForYou',
      permission: 'workspace',
      params: z.object({ person: z.string().min(1).optional() }),
      handler: (p) => doneForYou(ctx(), readers().effects, p.person ?? null, Date.now())
    }),
    defineMethod({
      name: 'pilot.runs.acknowledge',
      permission: 'workspace',
      params: RunIds,
      handler: (p, rpc) => acknowledgeRuns(ctx(), p.runIds, requirePerson(rpc.caller), Date.now())
    })
  ]
}
