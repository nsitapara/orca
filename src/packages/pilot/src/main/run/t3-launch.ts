import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentKind } from '../../shared/definition/types'
import type { ExecResult } from './foreign-exec'
import type { ForeignLauncher } from './foreign-launch'
import {
  notT3sLauncher,
  parseT3Launcher,
  resolveOnPath,
  t3Invocation,
  t3Started,
  type T3Launch,
  type T3Report,
  type T3Started
} from './t3-cli'

// T3's provider instance for each agent: a thread takes a provider only together with a model.
const T3_PROVIDER: Record<AgentKind, string> = { claude: 'claudeAgent', codex: 'codex' }

// How Pilot reaches T3: starts a thread for the launch, the prompt as its first message.
export type T3Client = { startThread(plan: T3Launch, message: string): Promise<T3Started> }

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
    return path.replace(/\/+$/, '')
  }
}

// A thread of the repo's own T3 project (the one whose root is its main checkout), bound to the run's worktree.
export function t3Launcher(deps: {
  client: T3Client
  // The repo's main checkout (Pilot's repo record).
  checkoutOf(repo: string): Promise<string>
  // The branch a worktree has checked out, if any: the branch T3 shows on the thread.
  branchOf(worktree: string): Promise<string | null>
}): ForeignLauncher {
  return async (launch) => {
    // t3 takes a model only with its provider instance; without one the project's default runs, which may not be the
    // step's agent: a codex step must name its model.
    const slug = modelArg(launch.args)
    if (!slug && launch.agent === 'codex') {
      throw new Error(
        "system t3 runs its project's default model unless the step names one; a codex step there needs --model in args"
      )
    }
    const projectRoot = await deps.checkoutOf(launch.repo)
    const worktree = real(launch.cwd) === real(projectRoot) ? null : launch.cwd
    const plan: T3Launch = {
      repo: launch.repo,
      projectRoot,
      worktree,
      branch: worktree ? await deps.branchOf(worktree) : null,
      title: launch.title,
      model: slug ? { provider: T3_PROVIDER[launch.agent], model: slug } : null
    }
    const started = await deps.client.startThread(plan, launch.prompt)
    return {
      externalRef: started.threadId,
      detail: {
        thread: started.threadId,
        ...(started.projectId ? { projectId: started.projectId } : {}),
        ...(started.runId ? { runId: started.runId } : {}),
        projectRoot,
        worktreePath: worktree ?? projectRoot
      }
    }
  }
}

// Runs `bin args` with `env` added to Pilot's scrubbed env, the prompt on stdin.
export type T3Run = (
  bin: string,
  args: readonly string[],
  env: Record<string, string>,
  input: string
) => Promise<ExecResult>

function readReport(path: string): T3Report | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8').trim()) as T3Report
  } catch {
    return null
  }
}

// T3's bundled CLI with pilotd's preload (resources/t3_hook.mjs.txt), as pilotd launches it. `hookPath` is null where
// Pilot ships no resources (orcad): t3 steps then fail rather than start unbound.
export function t3CliClient(deps: {
  launcher: string
  hookPath: string | null
  run: T3Run
}): T3Client {
  return {
    async startThread(plan, message) {
      if (deps.hookPath === null) {
        throw new Error(
          "This Pilot ships no T3 preload (t3_hook.mjs), so it can't bind a T3 thread to a worktree"
        )
      }
      const launcher = resolveOnPath(deps.launcher)
      let script: string
      try {
        script = readFileSync(launcher, 'utf8')
      } catch (error) {
        throw new Error(
          `t3 (${launcher}): couldn't read T3's launcher: ${(error as Error).message}`
        )
      }
      const parsed = parseT3Launcher(launcher, script)
      if (!parsed) {
        throw notT3sLauncher(launcher)
      }
      const dir = mkdtempSync(join(tmpdir(), 'pilot-t3-'))
      try {
        const hook = join(dir, 't3_hook.mjs')
        const report = join(dir, 'report.json')
        writeFileSync(hook, readFileSync(deps.hookPath, 'utf8'))
        const { bin, args, env } = t3Invocation(parsed, plan, hook, report)
        let out: ExecResult
        try {
          out = await deps.run(bin, args, env, message)
        } catch (error) {
          throw new Error(`t3 (${launcher}): ${(error as Error).message}`)
        }
        return t3Started(out, readReport(report), plan)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  }
}
