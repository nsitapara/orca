import { realpathSync } from 'node:fs'
import type { AgentKind } from '../../shared/definition/types'
import type { Exec } from './foreign-exec'
import type { ForeignLauncher } from './foreign-launch'

// T3's provider instance for each agent: a thread takes a provider only together with a model.
const T3_PROVIDER: Record<AgentKind, string> = { claude: 'claudeAgent', codex: 'codex' }

export type T3Project = { id: string; workspaceRoot: string }
export type T3ThreadRequest = {
  // A project id; or, where the transport can't list projects, the repo's main checkout (T3 resolves it).
  project: string
  // The run's worktree when it isn't the project's root: the thread is bound to it (existing_worktree). Null: the root.
  worktreePath: string | null
  title: string
  message: string
  model: { provider: string; model: string } | null
}
// How Pilot reaches T3. `projects` is null when the transport can't list them; `startThread` returns the thread id.
export type T3Client = {
  projects(): Promise<T3Project[] | null>
  startThread(req: T3ThreadRequest): Promise<string>
}

// The step's --model (`--model x` or `--model=x`); T3 takes no other agent args.
export function modelArg(args: readonly string[]): string | null {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--model') {
      return args[i + 1] ?? null
    }
    if (args[i].startsWith('--model=')) {
      return args[i].slice('--model='.length)
    }
  }
  return null
}

function real(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

// The repo's T3 project: the one whose root is the repo's main checkout.
export function projectForCheckout(
  projects: readonly T3Project[],
  checkout: string
): T3Project | null {
  const target = real(checkout)
  return projects.find((p) => real(p.workspaceRoot) === target) ?? null
}

// A thread of the repo's own T3 project (matched by its main checkout), bound to the run's worktree, the prompt as its
// first message.
export function t3Launcher(deps: {
  client: T3Client
  // The repo's main checkout (Pilot's repo record).
  checkoutOf(repo: string): Promise<string>
}): ForeignLauncher {
  return async (launch) => {
    const checkout = await deps.checkoutOf(launch.repo)
    const projects = await deps.client.projects()
    let project = checkout
    if (projects !== null) {
      const found = projectForCheckout(projects, checkout)
      if (!found) {
        throw new Error(
          `No T3 project has ${checkout} (repo ${launch.repo}) as its folder; add it in T3`
        )
      }
      project = found.id
    }
    const model = modelArg(launch.args)
    const threadId = await deps.client.startThread({
      project,
      worktreePath: real(launch.cwd) === real(checkout) ? null : launch.cwd,
      title: launch.title,
      message: launch.prompt,
      model: model ? { provider: T3_PROVIDER[launch.agent], model } : null
    })
    return { externalRef: threadId, detail: { thread: threadId, project } }
  }
}

function failed(what: string, stdout: string, stderr: string): Error {
  return new Error(`t3 ${what} failed: ${stderr.trim() || stdout.trim() || 'no output'}`)
}

// The t3 CLI as the transport. It has no `project list` today (projects is then null and T3 resolves the checkout path
// itself), and `thread start` runs in the project's root or a NEW worktree only: a run in an existing worktree is
// refused here, never started in the root. The existing_worktree transport replaces startThread (T3's server takes
// workspaceStrategy { type: 'existing_worktree', worktreePath } on thread creation, as its MCP t3_thread_launch does).
export function t3CliClient(t3: Exec): T3Client {
  return {
    async projects() {
      const { code, stdout } = await t3(['project', 'list', '--json'])
      if (code !== 0) {
        return null
      }
      try {
        const parsed = JSON.parse(stdout) as T3Project[] | { projects?: T3Project[] }
        return Array.isArray(parsed) ? parsed : (parsed.projects ?? [])
      } catch {
        return null
      }
    },
    async startThread(req) {
      if (req.worktreePath !== null) {
        throw new Error(
          `t3's CLI can't start a thread in an existing worktree (${req.worktreePath}); it runs only in the project's folder`
        )
      }
      const args = [
        'thread',
        'start',
        req.project,
        '-',
        '--title',
        req.title,
        ...(req.model ? ['--provider', req.model.provider, '--model', req.model.model] : []),
        '--json'
      ]
      const { code, stdout, stderr } = await t3(args, req.message)
      if (code !== 0) {
        throw failed('thread start', stdout, stderr)
      }
      let threadId: unknown
      try {
        threadId = (JSON.parse(stdout.trim()) as { threadId?: unknown }).threadId
      } catch {
        threadId = undefined
      }
      if (typeof threadId !== 'string' || !threadId) {
        throw new Error(`t3 thread start returned no thread id: ${stdout.trim() || 'no output'}`)
      }
      return threadId
    }
  }
}
