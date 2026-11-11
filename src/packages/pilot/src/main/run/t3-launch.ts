import type { AgentKind } from '../../shared/definition/types'
import type { Exec } from './foreign-exec'
import type { ForeignLauncher } from './foreign-launch'

// T3's provider instance for each agent: `t3 thread start` takes --provider only together with --model.
const T3_PROVIDER: Record<AgentKind, string> = { claude: 'claudeAgent', codex: 'codex' }

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

// `t3 thread start <worktree> - --title … [--provider … --model …] --json`, the prompt on stdin (it may be long, or start
// with "-"). T3 resolves the path to the project whose root holds it and runs the thread in that root, so the run's
// worktree must itself be a T3 project's root: T3 refuses one outside every project ("No T3 Code project matches").
export function t3Launcher(t3: Exec): ForeignLauncher {
  return async (launch) => {
    const model = modelArg(launch.args)
    const args = [
      'thread',
      'start',
      launch.cwd,
      '-',
      '--title',
      launch.title,
      ...(model ? ['--provider', T3_PROVIDER[launch.agent], '--model', model] : []),
      '--json'
    ]
    const { code, stdout, stderr } = await t3(args, launch.prompt)
    if (code !== 0) {
      throw new Error(`t3 thread start failed: ${stderr.trim() || stdout.trim() || 'no output'}`)
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
    return { externalRef: threadId, detail: { thread: threadId } }
  }
}
