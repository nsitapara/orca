import { homeOf } from '../../shared/api-types-env'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { PilotStore } from '../store/store'
import type { ActionCaller } from './types'

export type CallerFolderDeps = {
  store: PilotStore
  definitions(): readonly AutomationDefinition[]
  // The main checkout of the repo an automation's `repo:` names, or null when Pilot doesn't list it.
  repoPath(repo: string): string | null
  exists(path: string): boolean
}

// The repo when every automation names the same one (mark-ready.py had one fixed project).
function onlyRepo(definitions: readonly AutomationDefinition[]): string | null {
  const repos = new Set(definitions.map((d) => d.repo))
  return repos.size === 1 ? [...repos][0] : null
}

function runHome(
  run: { homePath?: string | null; worktreePath: string | null } | null
): string | null {
  return run ? homeOf(run) : null
}

// Where pilotcli acts for an action (its -C): Pilot runs pilotcli from ~, so a numeric iid needs a folder to name the
// project. The asking card's worktree, or a run's own for its attempt, while the folder is there; else the main
// checkout of its automation's repo; for a call no card or run makes (a dry run by hand), the one repo Pilot's
// automations name. Null when none of these is there.
export function callerFolder(deps: CallerFolderDeps, caller: ActionCaller): string | null {
  const card = caller.inboxItemId ? deps.store.inbox.get(caller.inboxItemId) : null
  const runId = card ? card.runId : caller.runId
  const run = runId ? deps.store.runs.get(runId) : null
  const own = card ? card.worktreePath : runHome(run)
  if (own && deps.exists(own)) {
    return own
  }
  const automationId = card?.automationId ?? run?.automationId ?? null
  const definitions = deps.definitions()
  const repo =
    automationId === null
      ? onlyRepo(definitions)
      : (definitions.find((d) => d.id === automationId)?.repo ?? null)
  const main = repo ? deps.repoPath(repo) : null
  return main && deps.exists(main) ? main : null
}

// Why an action can't run when callerFolder finds nothing: pilotcli would refuse the numeric iid, and that refusal must
// not read as the card's own, so the entry fails first.
export function noFolder(iid: string): string {
  return `no folder to run pilotcli in for !${iid}: the card's worktree is gone and Pilot lists no checkout of its repo`
}
