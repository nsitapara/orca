import type { TuiAgent } from '../../../../../shared/tui-agent'
import {
  quoteStartupArg,
  resolveStartupShell,
  type AgentStartupShell
} from '../../../../../shared/tui-agent-startup-shell'

// Hook target: src/main/runtime/terminal/launch/terminal-create-deduplication.ts (pilot-hook:
// agent-launch-env). launchAgentTerminal forwards no caller env, and its extraAgentArgs allow only
// --model/--effort/--add-dir (src/shared/automation-extra-agent-args.ts), so a Pilot step's env
// (PILOT_*) and its --session-id/--resume/args arrive here, on `opts.pilot`.
export type PilotLaunchExtras = { env: Record<string, string>; argv: string[] }
export type PilotAgentLaunchOptions = {
  agent: TuiAgent
  prompt: string
  title?: string
  pilot: PilotLaunchExtras
}
type BuiltStartup = { startup: { command: string; env?: Record<string, string> } }

// Claude and Codex take the prompt as the last argument (`<command> <args> '<prompt>'`), so Pilot's
// argv goes right before it. Any other shape is refused: an agent must never start without its
// pinned session id or env.
export function spliceAgentArgv(
  command: string,
  prompt: string,
  argv: readonly string[],
  shell: AgentStartupShell = resolveStartupShell(process.platform)
): string {
  if (argv.length === 0) {
    return command
  }
  const args = argv.map((arg) => quoteStartupArg(arg, shell)).join(' ')
  const text = prompt.trim()
  if (!text) {
    return `${command} ${args}`
  }
  const quoted = ` ${quoteStartupArg(text, shell)}`
  if (!command.endsWith(quoted)) {
    throw new Error(
      "Pilot couldn't place its arguments before the agent's prompt in its launch command"
    )
  }
  return `${command.slice(0, -quoted.length)} ${args}${quoted}`
}

// Upstream callers pass no `pilot` key and get the very same object back.
export function withPilotAgentLaunch<T extends BuiltStartup>(
  opts: { prompt?: string },
  built: T
): T {
  const extras = (opts as { pilot?: PilotLaunchExtras }).pilot
  if (!extras) {
    return built
  }
  return {
    ...built,
    startup: {
      ...built.startup,
      command: spliceAgentArgv(built.startup.command, opts.prompt ?? '', extras.argv),
      env: { ...built.startup.env, ...extras.env }
    }
  }
}
