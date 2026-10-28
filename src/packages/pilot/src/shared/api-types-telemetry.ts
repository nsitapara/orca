import { z } from 'zod'

// What Pilot reads of `pilotcli self get-telemetry` and `self list-telemetry-calls` (pilotCLI
// docs/specs/2026-10-17-telemetry-design.md). Fields a pilotcli from before 2026-10-17 doesn't send are optional,
// so the panel works with it and adds the chart, sparklines and failures once pilotcli has them. zod drops every
// field not named here: Pilot keeps ids, names and counts only.

export const TELEMETRY_WINDOWS = ['7d', '30d', '90d'] as const
export type TelemetryWindow = (typeof TELEMETRY_WINDOWS)[number]
export function isTelemetryWindow(value: string): value is TelemetryWindow {
  return (TELEMETRY_WINDOWS as readonly string[]).includes(value)
}

// A command name as pilotcli prints it ("gitlab check-mr"): the only name pilot.telemetry.get passes on as a
// condition. pilotcli's row for calls it couldn't name ("") and one-word names from before modules had verbs don't
// pass, so the panel doesn't offer them to pick.
export const TELEMETRY_COMMAND = /^[a-z]+ [a-z]+(?:-[a-z]+)*$/
export const TELEMETRY_COMMAND_MAX = 80
export function isTelemetryCommandName(name: string): boolean {
  return name.length <= TELEMETRY_COMMAND_MAX && TELEMETRY_COMMAND.test(name)
}

const Callers = z.object({
  claude: z.number(),
  codex: z.number(),
  pilot: z.number(),
  app: z.number().optional(),
  shell: z.number()
})
// A call with an empty or unknown outcome counts in calls but in none of these.
const Outcomes = z.object({
  ok: z.number(),
  skip: z.number(),
  invalid: z.number(),
  failed: z.number(),
  not_yet: z.number(),
  needs_agent: z.number()
})

export const TelemetryUsageSchema = z.object({
  from: z.string(),
  to: z.string(),
  oldest: z.string().optional(),
  calls: z.number(),
  include_dev: z.boolean(),
  totals: z.object({ failed: z.number(), invalid: z.number(), callers: Callers }).optional(),
  buckets: z.array(z.string()).optional(),
  series: z
    .object({
      calls: z.array(z.number()),
      failed: z.array(z.number()),
      invalid: z.array(z.number())
    })
    .optional(),
  commands: z.array(
    z.object({
      command: z.string(),
      removed: z.boolean().optional(),
      calls: z.number(),
      failed: z.number(),
      invalid: z.number(),
      outcomes: Outcomes.optional(),
      callers: Callers,
      automations: z.record(z.string(), z.number()).optional(),
      p50_ms: z.number(),
      p95_ms: z.number(),
      max_ms: z.number().optional(),
      last: z.string(),
      series: z.array(z.number()).optional()
    })
  ),
  unused: z.array(z.string()),
  jobs: z.array(
    z.object({
      automation: z.string(),
      name: z.string(),
      runs: z.number(),
      calls: z.number(),
      failed: z.number().optional(),
      invalid: z.number().optional(),
      steps: z.array(
        z.object({
          step: z.string(),
          commands: z.array(z.object({ command: z.string(), calls: z.number() }))
        })
      )
    })
  ),
  left_out: z.object({ dev: z.number(), malformed: z.number() })
})
export type TelemetryUsage = z.infer<typeof TelemetryUsageSchema>
export type TelemetryCommand = TelemetryUsage['commands'][number]
export type TelemetryJob = TelemetryUsage['jobs'][number]

export const TelemetryCallSchema = z.object({
  ts: z.string(),
  command: z.string(),
  // Beside an empty command: the command the call attempted, by name only (pilotcli's ShownAttempted).
  attempted: z.string().optional(),
  outcome: z.string(),
  // The call was a --dry-run: it changed nothing, so its refusal is one the dry run caught (2026-10-28).
  dry_run: z.boolean().optional(),
  cause: z.string().optional(),
  http_status: z.number().optional(),
  exit: z.number(),
  duration_ms: z.number(),
  caller: z.string(),
  agent: z.string(),
  automation: z.string().optional(),
  run: z.string().optional(),
  step: z.string().optional(),
  flags: z.array(z.string()).optional()
})
export const TelemetryCallsSchema = z.array(TelemetryCallSchema)
export type TelemetryCall = z.infer<typeof TelemetryCallSchema>

export type TelemetryParams = { since: TelemetryWindow; includeDev: boolean; command?: string }
// The failed and invalid calls, or why there are none to show (a pilotcli without the list, or its error).
export type TelemetryFailures = { calls: TelemetryCall[]; more: boolean } | { unavailable: string }
export type TelemetryPayload =
  | { fetchedAt: number; usage: TelemetryUsage; failures: TelemetryFailures }
  | { fetchedAt: number; error: string }
