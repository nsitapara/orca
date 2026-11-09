import type { ClearRequest } from '../../shared/api-types-capacity'
import { oncePerKey } from '../../shared/template'
import { latestFieldsFor } from '../inbox/run-fields'
import type { PilotContext } from '../pilot-context'
import { originOf } from '../sources/kept-branches'

// The jobs to tick by hand after a clear, with the keys they should look at again.
export type ClearTick = { automationId: string; keys: string[] }

function definitionOf(c: PilotContext, automationId: string) {
  const def = c.loaded().definitions.find((d) => d.id === automationId)
  if (!def) {
    throw new Error(`No automation "${automationId}"`)
  }
  return def
}

async function deleteKept(c: PilotContext, repo: string, branch: string): Promise<void> {
  if (!branch.startsWith('pilot/')) {
    throw new Error(`${branch} isn't a kept pilot/ branch`)
  }
  if (!c.deleteKeptBranch) {
    throw new Error("Clear can't delete a branch here: this Pilot process doesn't know the repos")
  }
  await c.deleteKeptBranch(repo, branch)
}

// The kept_branch jobs (job 15), each asked to look at the run's item again so its rows go at once.
function keptJobs(c: PilotContext, runId: string): ClearTick[] {
  return c
    .loaded()
    .definitions.filter((d) => d.items?.kind === 'kept_branch')
    .map((d) => ({ automationId: d.id, keys: [`kept:${runId}`] }))
}

// Clear on the Running page (Nish, 2026-11-09). A fix kept on a pilot/ branch, whether its job 15 item waits or its Merge
// back row, goes with its branch. A key the runner gave up on, or any other item waiting in line, is settled done, so it
// isn't started again until its item changes; a waiting item also leaves the line.
export async function clearItem(
  c: PilotContext,
  req: ClearRequest,
  now: number
): Promise<ClearTick[]> {
  if (req.kind === 'gaveUp') {
    definitionOf(c, req.automationId)
    c.store.clearHandled(req.automationId, req.onceKey, now)
    return []
  }
  if (req.kind === 'mergeBack') {
    const run = c.store.runs.get(req.keptRunId)
    const branch = run?.env?.kept
    const repo = run ? originOf(c.store, run)?.repo : undefined
    if (!run || !branch || run.env?.keptGoneAt) {
      throw new Error(`Run ${req.keptRunId} has no fix kept on a branch`)
    }
    if (!repo) {
      throw new Error(`No automation file says which repo run ${req.keptRunId} worked in`)
    }
    await deleteKept(c, repo, branch)
    c.store.runs.envs.keptGone(run.id, now)
    return keptJobs(c, run.id)
  }
  const def = definitionOf(c, req.automationId)
  const fields = latestFieldsFor(c.store, req.automationId, req.itemKey)
  if (def.items?.kind === 'kept_branch') {
    const branch = fields['kept.branch']
    if (typeof branch !== 'string' || branch === '') {
      throw new Error(`"${req.itemKey}" names no kept branch`)
    }
    await deleteKept(c, def.repo, branch)
    const runId = fields['kept.run']
    if (typeof runId === 'string' && c.store.runs.get(runId)?.env?.kept === branch) {
      c.store.runs.envs.keptGone(runId, now)
    }
    c.store.capacity.dequeue(req.automationId, req.itemKey)
    return [{ automationId: def.id, keys: [req.itemKey] }]
  }
  // Why: without the item's fields the key would be a different one, and the item would start anyway.
  if (def.oncePer && Object.keys(fields).length === 0) {
    throw new Error(
      `Pilot no longer has "${req.itemKey}"'s fields; clear it after its job checks it again`
    )
  }
  c.store.clearHandled(req.automationId, oncePerKey(def.oncePer, fields, req.itemKey), now)
  c.store.capacity.dequeue(req.automationId, req.itemKey)
  return []
}
