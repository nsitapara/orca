import { basename, isAbsolute, join } from 'node:path'
import { gitExecFileAsync } from '../../../../../main/git/command-runner/git-exec-file'
import { gitOptionalLocksDisabledEnv } from '../../../../../main/git/command-runner/git-process-env'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { isTerminalGoneError, terminalRelister, type TerminalRelist } from '../run/terminal-relist'
import type { PilotStore } from '../store/store'
import { detectGitOperation, type FactDeps } from './worktree-fields'

type GitRunner = (
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv }
) => Promise<{ stdout: string }>

// How far back a finished step's tab still counts as maybe open (session: none_open).
export const SESSION_LOOKBACK_MS = 7 * 24 * 60 * 60_000

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
  git: GitRunner = gitExecFileAsync,
  opts: { relist?: TerminalRelist; now?: () => number } = {}
): FactDeps {
  const relist = opts.relist ?? terminalRelister(runtime)
  const now = opts.now ?? Date.now
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
    automationSessions(automationId, worktreePath) {
      return store.runs
        .sessionStepsIn(automationId, worktreePath, now() - SESSION_LOOKBACK_MS)
        .map((s) => ({
          active: s.status === 'starting' || s.status === 'running',
          handle: s.terminalHandle,
          paneKey: s.paneKey
        }))
    },
    async terminalAlive(handle, paneKey) {
      try {
        await runtime.showTerminal(handle)
        return true
      } catch (error) {
        // Only a terminal showTerminal can't find may be gone (isTerminalGoneError, the same errors
        // the step watcher uses). Anything else (runtime not ready) is unknown, so it is rethrown
        // and the fact stays absent.
        if (!isTerminalGoneError(error)) {
          throw error
        }
        // Stale is also what a terminal looks like right after an app restart: the PTY host's
        // inventory decides (terminal-relist.ts). If it can't say, that error leaves the fact unknown.
        return relist(handle, paneKey)
      }
    }
  }
}
