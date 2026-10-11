import { basename } from 'node:path'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { ItemFields } from '../../shared/api-types'
import type { AutomationDefinition, WorkspaceDef } from '../../shared/definition/types'
import { renderTemplate } from '../../shared/template'
import type { WorktreeInfo } from '../fields/worktree-facts'

export type Workspace = {
  kind: WorkspaceDef['kind']
  path: string
  worktreeId: string | null
  selector: string
  created: boolean
}
export type NewWorktreeRequest = {
  repoPath: string
  name: string
  base: string
  comment: string
  linkedLinearIssue: string | null
  linkedGitLabMR: number | null
  setup: 'run' | 'skip'
  noParent: true
}
export type WorkspaceDeps = {
  listWorktrees(repoPath: string): Promise<WorktreeInfo[]>
  createWorktree(req: NewWorktreeRequest): Promise<{ id: string; path: string }>
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
    id = (await deps.listWorktrees(repoPath)).find((w) => w.path === repoPath)?.id ?? null
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
  if (ws.reuseExisting) {
    const found = (await deps.listWorktrees(repoPath)).find((w) => sameName(w, name))
    if (found) {
      return {
        kind: 'new_worktree',
        path: found.path,
        worktreeId: found.id,
        selector: `id:${found.id}`,
        created: false
      }
    }
  }
  const iid = req.fields['mr.iid']
  const created = await deps.createWorktree({
    repoPath,
    name,
    base: ws.base,
    comment: `Created by the Pilot automation "${req.definition.name}" (run ${req.runId})`,
    linkedLinearIssue: text(req.fields, 'ticket.id'),
    linkedGitLabMR: typeof iid === 'number' ? iid : null,
    setup: ws.setup,
    noParent: true
  })
  return {
    kind: 'new_worktree',
    path: created.path,
    worktreeId: created.id,
    selector: `id:${created.id}`,
    created: true
  }
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
  return newWorktree(req, ws, repoPath, deps)
}

// Setup follows the workspace's `setup` (default skip, as Orca's own new-per-run automations); the new
// worktree has no parent, as the old sweeps' --no-parent.
export function runtimeWorkspaceDeps(
  runtime: OrcaRuntimeService,
  listWorktrees: WorkspaceDeps['listWorktrees']
): WorkspaceDeps {
  return {
    listWorktrees,
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
        ...(req.linkedLinearIssue ? { linkedLinearIssue: req.linkedLinearIssue } : {}),
        ...(req.linkedGitLabMR !== null ? { linkedGitLabMR: req.linkedGitLabMR } : {})
      })
      return { id: result.worktree.id, path: result.worktree.path }
    }
  }
}
