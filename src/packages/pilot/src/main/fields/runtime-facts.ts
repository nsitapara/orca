import { basename, isAbsolute, join } from 'node:path'
import { gitExecFileAsync } from '../../../../../main/git/command-runner/git-exec-file'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { PilotStore } from '../store/store'
import { detectGitOperation, type FactDeps } from './worktree-fields'

function stripRefsHeads(branch: string): string {
  return branch.replace(/^refs\/heads\//, '')
}

export async function resolveRepoPath(
  runtime: OrcaRuntimeService,
  repo: string
): Promise<{ id: string; path: string }> {
  const match = runtime.listRepos().find((r) => r.displayName === repo || basename(r.path) === repo)
  if (!match) {
    throw new Error(
      `Repo "${repo}" isn't added to Pilot. Add it in the sidebar, or fix "repo:" in the automation file.`
    )
  }
  return { id: match.id, path: match.path }
}

export function runtimeFactDeps(runtime: OrcaRuntimeService, store: PilotStore): FactDeps {
  return {
    async listWorktrees(repoPath) {
      const repo = runtime.listRepos().find((r) => r.path === repoPath)
      if (!repo) {
        return []
      }
      const result = await runtime.listManagedWorktrees(`id:${repo.id}`)
      return result.worktrees.map((w) => ({
        id: w.id,
        path: w.git.path,
        branch: stripRefsHeads(w.git.branch)
      }))
    },
    async gitStatusCount(path) {
      const { stdout } = await gitExecFileAsync(['status', '--porcelain=v1'], { cwd: path })
      return stdout.split('\n').filter(Boolean).length
    },
    async gitOperation(path) {
      const { stdout } = await gitExecFileAsync(['rev-parse', '--git-dir'], { cwd: path })
      const gitDir = stdout.trim()
      return detectGitOperation(isAbsolute(gitDir) ? gitDir : join(path, gitDir))
    },
    openSessionHandles(automationId, worktreePath) {
      return store.runs
        .openStepsIn(automationId, worktreePath)
        .flatMap((s) => (s.terminalHandle ? [s.terminalHandle] : []))
    },
    async terminalAlive(handle) {
      try {
        await runtime.showTerminal(handle)
        return true
      } catch {
        return false
      }
    }
  }
}
