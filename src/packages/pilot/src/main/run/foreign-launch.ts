import type { ForeignSystem } from '../../shared/api-types'
import type { AgentKind, AutomationDefinition, StepDef } from '../../shared/definition/types'

// One hand-over step's session to start on another system (step system: herdr, t3). Everything Pilot built for its own
// tab: the prompt, the step env and the agent argv (session id, then the step's args).
export type ForeignLaunch = {
  system: ForeignSystem
  agent: AgentKind
  runId: string
  stepIdx: number
  // The automation's repo: herdr's workspace label.
  repo: string
  // The run's worktree: the herdr tab's cwd, the T3 thread's project path.
  cwd: string
  title: string
  prompt: string
  env: Record<string, string>
  argv: string[]
  args: readonly string[]
}
// Where the session lives now: herdr's tab id, or T3's thread id; `detail` goes in the step's timeline event.
export type ForeignLaunched = { externalRef: string; detail: Record<string, string> }
export type ForeignLauncher = (launch: ForeignLaunch) => Promise<ForeignLaunched>
export type ForeignLaunchers = Record<ForeignSystem, ForeignLauncher>

export function foreignSystemOf(step: StepDef): ForeignSystem | null {
  return step.system === 'herdr' || step.system === 't3' ? step.system : null
}

// Pilot follows a step to its end only in its own tabs: on another system only a hand-over step runs. There it starts a
// new session only: resuming one (session: continue, per_worktree, Continue run) could put a second process on a session
// still open in a Pilot tab, and T3 keeps its own session ids. `resuming`: the session Pilot planned is an existing one.
export function foreignRefusal(
  step: StepDef,
  system: ForeignSystem,
  resuming: boolean
): string | null {
  if (step.wait !== 'start') {
    return `system ${system} can't report a step's end to Pilot; only a wait: start step can run there`
  }
  if (resuming) {
    return `system ${system} starts a new session; it can't resume one`
  }
  return null
}

// The spec's name for a session started elsewhere: always "[Automation] <job> · <item> · <step>", hand-over or not, so
// herdr's tab bar and T3's thread list say who started it.
export function foreignTitle(
  definition: AutomationDefinition,
  step: StepDef,
  label: string
): string {
  return `[Automation] ${definition.name} · ${label} · ${step.name}`
}

// A parent agent session's markers (Claude Code, its SDK, T3) and herdr's own pane context: inherited, they would make
// the step's agent a child session, or point the herdr CLI at the pane that runs Pilot rather than its own session.
export function isInheritedSessionVar(name: string): boolean {
  return (
    name === 'CLAUDECODE' ||
    name.startsWith('CLAUDE_CODE_') ||
    name.startsWith('HERDR_') ||
    name.startsWith('T3CODE_')
  )
}

export function cleanChildEnv(
  env: NodeJS.ProcessEnv,
  extra: Record<string, string> = {}
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !isInheritedSessionVar(name)) {
      out[name] = value
    }
  }
  return { ...out, ...extra }
}

// POSIX single quoting (herdr and t3 run on macOS and Linux only).
export function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
