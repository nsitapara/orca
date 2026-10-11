import { isAbsolute, join } from 'node:path'
import { gitExecFileAsync } from '../../../../../main/git/command-runner/git-exec-file'
import { gitOptionalLocksDisabledEnv } from '../../../../../main/git/command-runner/git-process-env'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { StepRow } from '../../shared/api-types'
import { paneStateFromRows } from '../run/agent-rows'
import { isTerminalGoneError, terminalRelister, type TerminalRelist } from '../run/terminal-relist'
import type { PilotStore } from '../store/store'
import { SESSION_LOOKBACK_MS, stripRefsHeads } from './runtime-facts'
import {
  detectGitOperation,
  type GitStatusCounts,
  type SessionStep,
  type WorktreeFactDeps
} from './worktree-facts'

type GitRunner = (
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv }
) => Promise<{ stdout: string }>

const TERMINAL_LIST_LIMIT = 10_000

// `??` lines are untracked files; every other non-empty porcelain line is a tracked change.
export function countGitStatus(porcelain: string): GitStatusCounts {
  let dirty = 0
  let untracked = 0
  for (const line of porcelain.split('\n')) {
    if (!line) {
      continue
    }
    if (line.startsWith('??')) {
      untracked += 1
    } else {
      dirty += 1
    }
  }
  return { dirty, untracked }
}

function toSessionSteps(rows: readonly StepRow[]): SessionStep[] {
  return rows.map((s) => ({
    active: s.status === 'starting' || s.status === 'running',
    handle: s.terminalHandle,
    paneKey: s.paneKey
  }))
}

// The field engine's facts, read through Orca's runtime (worktrees, terminals, hook rows) and git.
export function runtimeFieldDeps(
  runtime: OrcaRuntimeService,
  store: PilotStore,
  opts: { git?: GitRunner; relist?: TerminalRelist; now?: () => number } = {}
): WorktreeFactDeps {
  const git = opts.git ?? gitExecFileAsync
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
        branch: stripRefsHeads(w.git.branch),
        head: w.git.head || null,
        linkedLinearIssue: w.linkedLinearIssue ?? null
      }))
    },
    async gitStatus(path) {
      // Optional locks off: a background read must not take index.lock from agents working there.
      const { stdout } = await git(['status', '--porcelain=v1'], {
        cwd: path,
        env: gitOptionalLocksDisabledEnv()
      })
      return countGitStatus(stdout)
    },
    async gitOperation(path) {
      const { stdout } = await git(['rev-parse', '--git-dir'], { cwd: path })
      const gitDir = stdout.trim()
      return detectGitOperation(isAbsolute(gitDir) ? gitDir : join(path, gitDir))
    },
    automationSessions(automationId, worktreePath) {
      return toSessionSteps(
        store.runs.sessionStepsIn(automationId, worktreePath, now() - SESSION_LOOKBACK_MS)
      )
    },
    anySessions(worktreePath) {
      return toSessionSteps(store.runs.sessionStepsAnyIn(worktreePath, now() - SESSION_LOOKBACK_MS))
    },
    async terminalAlive(handle, paneKey) {
      try {
        await runtime.showTerminal(handle)
        return true
      } catch (error) {
        // As M1: only a terminal showTerminal can't find may be gone; the PTY host's listing decides.
        if (!isTerminalGoneError(error)) {
          throw error
        }
        return relist(handle, paneKey)
      }
    },
    async agentTerminals() {
      const listed = await runtime.listTerminals(undefined, TERMINAL_LIST_LIMIT, {
        includeVisualLayouts: false
      })
      if (listed.truncated) {
        throw new Error(`terminal list cut short (${listed.totalCount} terminals)`)
      }
      return listed.terminals
        .filter((t) => t.connected && t.agentIdentity !== undefined)
        .map((t) => ({
          handle: t.handle,
          worktreePath: t.worktreePath,
          paneKey: `${t.tabId}:${t.leafId}`
        }))
    },
    paneState(paneKey) {
      return paneStateFromRows(runtime.getAgentStatusRowsForPane(paneKey))
    },
    // Why the screen read: the default read carries `draft` only on its screen-fallback paths.
    async terminalDraft(handle) {
      const read = await runtime.readTerminal(handle, { screen: true, limit: 1 })
      return read.draft ?? ''
    }
  }
}
