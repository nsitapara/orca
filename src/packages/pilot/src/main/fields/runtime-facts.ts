import { basename, isAbsolute, join } from 'node:path'
import { gitExecFileAsync } from '../../../../../main/git/command-runner/git-exec-file'
import { gitOptionalLocksDisabledEnv } from '../../../../../main/git/command-runner/git-process-env'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { PilotStore } from '../store/store'
import { detectGitOperation, type FactDeps } from './worktree-fields'

type GitRunner = (
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv }
) => Promise<{ stdout: string }>

const STALE_HANDLE = 'terminal_handle_stale'
const AGENT_SESSION_HANDLE = 'terminal_unsupported_for_agent_session'

function isGoneError(error: Error): boolean {
  const code = (error as { code?: unknown }).code
  return error.message === STALE_HANDLE || code === AGENT_SESSION_HANDLE
}

export function stripRefsHeads(branch: string): string {
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

export function runtimeFactDeps(
  runtime: OrcaRuntimeService,
  store: PilotStore,
  git: GitRunner = gitExecFileAsync
): FactDeps {
  return {
    async listWorktrees(repoPath) {
      const repo = runtime.listRepos().find((r) => r.path === repoPath)
      if (!repo) {
        throw new Error(
          `Repo at ${repoPath} isn't added to Pilot, so its worktrees can't be listed`
        )
      }
      const result = await runtime.listManagedWorktrees(`id:${repo.id}`)
      if (result.truncated) {
        throw new Error(
          `Worktree list for ${repoPath} was cut short (${result.totalCount} worktrees)`
        )
      }
      return result.worktrees.map((w) => ({
        id: w.id,
        path: w.git.path,
        branch: stripRefsHeads(w.git.branch)
      }))
    },
    async gitStatusCount(path) {
      // Optional locks off: a background read must not take index.lock from agents working in the worktree.
      const { stdout } = await git(['status', '--porcelain=v1'], {
        cwd: path,
        env: gitOptionalLocksDisabledEnv()
      })
      return stdout.split('\n').filter(Boolean).length
    },
    async gitOperation(path) {
      const { stdout } = await git(['rev-parse', '--git-dir'], { cwd: path })
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
      } catch (error) {
        // Only a stale handle means the session is gone. Anything else (runtime not ready, an agent
        // session without a terminal) is unknown, so it is rethrown and the fact stays absent.
        // A structured-worker handle (the refusal carries the code) can never be our terminal either.
        if (error instanceof Error && isGoneError(error)) {
          return false
        }
        throw error
      }
    }
  }
}
