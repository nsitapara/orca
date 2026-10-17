import { z } from 'zod'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { defineMethod } from '../../../../../main/runtime/rpc/core'
import type { ImportStateResult } from '../../shared/api-types'
import { importState } from '../importer/sweep-state/apply'
import { fsStateReader, sweepStatePaths } from '../importer/sweep-state/fs-reader'
import { MAPPERS, sweepStateIds, sweepStateMapper } from '../importer/sweep-state/registry'
import type { StateWorktree, SweepStateMapper } from '../importer/sweep-state/types'
import type { PilotHost } from '../pilot-services'

const ImportParams = z.object({ id: z.string().min(1), apply: z.boolean().optional() })

export const IMPORT_NO_CALLER = "Pilot can't tell who is calling; nothing was imported"

export const IMPORT_STATE_APPLY_ON_MAC =
  'Apply the state import on the Mac Pilot runs on (pilot automations import-state --apply); a paired device only previews it'

// Every managed worktree the runtime lists, for mappers that match old state to worktrees (StateReader.worktrees).
// A cut-short list is refused, so no mapper matches old tabs against part of the worktrees.
export async function listWorktrees(runtime: OrcaRuntimeService): Promise<StateWorktree[]> {
  const found: StateWorktree[] = []
  for (const repo of runtime.listRepos()) {
    const listed = await runtime.listManagedWorktrees(`id:${repo.id}`)
    if (listed.truncated) {
      throw new Error(
        `Worktree list for ${repo.path} was cut short (${listed.totalCount} worktrees)`
      )
    }
    for (const w of listed.worktrees) {
      const branch = w.git.branch ? w.git.branch.replace(/^refs\/heads\//, '') : null
      found.push({ id: w.id, path: w.git.path, branch })
    }
  }
  return found
}

// Mapper ids need no loaded YAML: a retired job (08) still imports its state.
// Who may apply is the transport's stamp, never a param. A preview is open to any identified caller. Applying is
// open to this Mac's own callers (the desktop and the local CLI, which go-live's runbook uses): the plan comes only
// from the old sweeps' files on this Mac, never from params, and applying only adds Pilot's own bookkeeping rows
// (handled keys, seen times, finished imported runs, queue rows marked already sent) and copies files to targets that
// are missing. Each of those makes Pilot start or send less, never more; nothing starts and nothing is sent. A paired
// device only previews.
export function buildImportMethods(
  host: PilotHost,
  now: () => number = Date.now,
  mappers: SweepStateMapper[] = MAPPERS
) {
  return [
    defineMethod({
      name: 'pilot.automations.importState',
      permission: 'workspace',
      params: ImportParams,
      handler: async (p, rpc): Promise<ImportStateResult> => {
        if (!host.context) {
          throw new Error(`Pilot isn't running: ${host.error ?? 'it has not started yet'}`)
        }
        if (!rpc.caller) {
          throw new Error(IMPORT_NO_CALLER)
        }
        if (p.apply && rpc.caller.kind === 'paired-device') {
          throw new Error(IMPORT_STATE_APPLY_ON_MAC)
        }
        const mapper = sweepStateMapper(p.id, mappers)
        if (!mapper) {
          const known = sweepStateIds(mappers).join(', ') || 'none'
          throw new Error(`No state importer for "${p.id}". Known: ${known}`)
        }
        const at = now()
        const worktrees = await listWorktrees(rpc.runtime)
        const read = fsStateReader(sweepStatePaths(host.dataDir), { worktrees, now: at })
        return importState(host.context.store, mapper, read, p.apply ?? false, at)
      }
    })
  ]
}
