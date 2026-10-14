import { basename } from 'node:path'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { ItemFields } from '../../shared/api-types'
import type { AutomationDefinition, WorkspaceDef } from '../../shared/definition/types'
import { renderTemplate } from '../../shared/template'
import { worktreePathKey } from '../fields/agent-activity'
import type { WorktreeInfo } from '../fields/worktree-facts'
import type { RunStore } from '../store/store-runs'

export type Workspace = {
  kind: WorkspaceDef['kind']
  path: string
  worktreeId: string | null
  selector: string
  created: boolean
  // An env run's variables (pilotcli's data.env), and whether its folder goes when the run ends (a throwaway).
  env?: Record<string, string>
  disposable?: boolean
}
export type NewWorktreeRequest = {
  repoPath: string
  name: string
  base: string
  comment: string
  // A ticket's worktree is labelled as Linear shows it ("WEB-2152 <title>"); null keeps Orca's label.
  displayName: string | null
  linkedLinearIssue: string | null
  linkedGitLabMR: number | null
  setup: 'run' | 'skip'
  noParent: true
}
export type WorkspaceDeps = {
  listWorktrees(repoPath: string): Promise<WorktreeInfo[]>
  createWorktree(req: NewWorktreeRequest): Promise<{ id: string; path: string }>
  // Takes a new_worktree workspace for the run (records it on the run); false when a running run of
  // any automation is in it. Synchronous: nothing can take the worktree between the check and the record.
  claimWorktree(runId: string, worktree: { id: string; path: string }): boolean
}
export type WorkspaceRequest = {
  definition: AutomationDefinition
  runId: string
  label: string
  fields: ItemFields
}
type NewWorktreeDef = Extract<WorkspaceDef, { kind: 'new_worktree' }>

function text(fields: ItemFields, key: string): string | null {
  const value = fields[key]
  return typeof value === 'string' && value !== '' ? value : null
}

function selectorFor(id: string | null, path: string): string {
  return id ? `id:${id}` : `path:${path}`
}

function itemWorktree(req: WorkspaceRequest): Workspace {
  const path = text(req.fields, 'worktree.path')
  if (path === null) {
    throw new Error(`No worktree for ${req.label}`)
  }
  const id = text(req.fields, 'worktree.id')
  return {
    kind: 'item_worktree',
    path,
    worktreeId: id,
    selector: selectorFor(id, path),
    created: false
  }
}

// Orca lists the main checkout as a worktree; when it can't say, the path selector still finds it.
async function mainCheckout(repoPath: string, deps: WorkspaceDeps): Promise<Workspace> {
  let id: string | null
  try {
    const main = worktreePathKey(repoPath)
    id =
      (await deps.listWorktrees(repoPath)).find((w) => worktreePathKey(w.path) === main)?.id ?? null
  } catch {
    id = null
  }
  return {
    kind: 'main_checkout',
    path: repoPath,
    worktreeId: id,
    selector: selectorFor(id, repoPath),
    created: false
  }
}

// A worktree "of that name": its folder, its branch, or its branch under a prefix (nish/<name>).
function sameName(w: WorktreeInfo, name: string): boolean {
  return basename(w.path) === name || w.branch === name || w.branch.endsWith(`/${name}`)
}

async function newWorktree(
  req: WorkspaceRequest,
  ws: NewWorktreeDef,
  repoPath: string,
  deps: WorkspaceDeps
): Promise<Workspace> {
  const { text: name, missing } = renderTemplate(ws.name, req.fields)
  if (missing.length > 0) {
    throw new Error(`Can't name the new worktree: ${missing.join(', ')} missing`)
  }
  return oneAtATime(repoPath, async () => {
    const found = ws.reuseExisting ? await reusable(name, repoPath, deps) : null
    const worktree = found ?? (await deps.createWorktree(createRequest(req, ws, repoPath, name)))
    if (!deps.claimWorktree(req.runId, worktree)) {
      throw new Error(`Worktree ${name} is busy`)
    }
    return {
      kind: 'new_worktree',
      path: worktree.path,
      worktreeId: worktree.id,
      selector: `id:${worktree.id}`,
      created: found === null
    }
  })
}

// The main checkout is never a "new worktree", whatever the name says.
async function reusable(
  name: string,
  repoPath: string,
  deps: WorkspaceDeps
): Promise<WorktreeInfo | null> {
  const main = worktreePathKey(repoPath)
  const listed = await deps.listWorktrees(repoPath)
  return listed.find((w) => worktreePathKey(w.path) !== main && sameName(w, name)) ?? null
}

function createRequest(
  req: WorkspaceRequest,
  ws: NewWorktreeDef,
  repoPath: string,
  name: string
): NewWorktreeRequest {
  const iid = req.fields['mr.iid']
  const ticket = text(req.fields, 'ticket.id')
  const title = text(req.fields, 'ticket.title')
  return {
    repoPath,
    name,
    base: ws.base,
    comment: `Created by the Pilot automation "${req.definition.name}" (run ${req.runId})`,
    displayName: ticket && title ? `${ticket} ${title}` : null,
    linkedLinearIssue: ticket,
    linkedGitLabMR: typeof iid === 'number' ? iid : null,
    setup: ws.setup,
    noParent: true
  }
}

// Up to four ticks run at once (Task 7). One repo's new worktrees are made one after another, so git's
// .git locks never contend; the reuse lookup waits its turn too, so it sees a worktree just created.
const repoTurns = new Map<string, Promise<unknown>>()

function oneAtATime<T>(repoPath: string, work: () => Promise<T>): Promise<T> {
  const key = worktreePathKey(repoPath)
  const turn = (repoTurns.get(key) ?? Promise.resolve()).then(work)
  const settled = turn.catch(() => undefined)
  repoTurns.set(key, settled)
  void settled.then(() => {
    if (repoTurns.get(key) === settled) {
      repoTurns.delete(key)
    }
  })
  return turn
}

// Spec §7: where a run works. Throws with the reason the run fails with.
export async function resolveWorkspace(
  req: WorkspaceRequest,
  deps: WorkspaceDeps
): Promise<Workspace> {
  const ws = req.definition.workspace
  if (ws.kind === 'item_worktree') {
    return itemWorktree(req)
  }
  const repoPath = text(req.fields, 'repo.path')
  if (repoPath === null) {
    throw new Error(`The repo's path is unknown for ${req.label}`)
  }
  if (ws.kind === 'main_checkout') {
    return mainCheckout(repoPath, deps)
  }
  if (ws.kind === 'env') {
    throw new Error(
      'An env workspace is prepared by the run engine (main/envs), never resolved here'
    )
  }
  return newWorktree(req, ws, repoPath, deps)
}

// Ruling 6a: a new worktree is one run's at a time, whichever automation's. Paths compare normalized
// (worktreePathKey) on both sides, however either was written.
function claimIn(runs: RunStore): WorkspaceDeps['claimWorktree'] {
  return (runId, worktree) => {
    const key = worktreePathKey(worktree.path)
    const taken = [...runs.runningWorktreePaths()].some(
      (path) =>
        worktreePathKey(path) === key && runs.runningInWorktree(path).some((r) => r.id !== runId)
    )
    if (taken) {
      return false
    }
    runs.update(runId, { worktreePath: worktree.path, worktreeId: worktree.id })
    return true
  }
}

// Setup follows the workspace's `setup` (default skip, as Orca's own new-per-run automations); the new
// worktree has no parent, as the old sweeps' --no-parent.
export function runtimeWorkspaceDeps(
  runtime: OrcaRuntimeService,
  listWorktrees: WorkspaceDeps['listWorktrees'],
  runs: RunStore
): WorkspaceDeps {
  return {
    listWorktrees,
    claimWorktree: claimIn(runs),
    async createWorktree(req) {
      const result = await runtime.createManagedWorktree({
        repoSelector: `path:${req.repoPath}`,
        name: req.name,
        baseBranch: req.base,
        setupDecision: req.setup,
        lineage: { noParent: req.noParent },
        activate: false,
        telemetrySource: 'unknown',
        comment: req.comment,
        // Generated: Orca sanitizes the external title. Without a label, the sidebar shows the
        // linked issue's bare title in place of a branch-named worktree's.
        ...(req.displayName
          ? { displayName: req.displayName, displayNameKind: 'generated' as const }
          : {}),
        ...(req.linkedLinearIssue ? { linkedLinearIssue: req.linkedLinearIssue } : {}),
        ...(req.linkedGitLabMR !== null ? { linkedGitLabMR: req.linkedGitLabMR } : {})
      })
      return { id: result.worktree.id, path: result.worktree.path }
    }
  }
}
