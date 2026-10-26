import { z } from 'zod'
import type { EnvMode, RunEnvStack } from '../../shared/api-types-env'
import { envNameProblem } from '../../shared/run/shell-template'

const resultSchema = z.looseObject({
  mode: z.enum(['in_place', 'throwaway', 'kept']),
  reason: z.string().optional(),
  path: z.string().regex(/^\//, 'expected an absolute path'),
  sha: z.string().nullable().optional(),
  stack: z
    .looseObject({
      kind: z.enum(['backend', 'full']),
      project: z.string(),
      urls: z.record(z.string(), z.string().nullable()).optional(),
      log: z.string().nullable().optional()
    })
    .nullable()
    .optional(),
  env: z.record(z.string(), z.string()).optional(),
  env_file: z.string().nullable().optional()
})
// env list's rows (Contract answers 4): {run, name, project, mode, status, path, stack, created, age_hours, orphan, stale,
// owner_run}. `run` is the id exactly as passed to create; an orphan's is "". owner_run is the run whose step made it
// (pilotcli 47bf79d); an older pilotcli sends none.
const rowsSchema = z.array(
  z.looseObject({
    run: z.string(),
    mode: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    path: z.string().nullable().optional(),
    created: z.string().nullable().optional(),
    orphan: z.boolean().optional(),
    owner_run: z.string().optional()
  })
)

export type EnvResult = {
  mode: EnvMode
  reason: string
  path: string
  sha: string | null
  envFile: string | null
  vars: Record<string, string>
  stack: RunEnvStack | null
}
export type EnvListRow = {
  run: string
  mode: string | null
  status: string | null
  path: string | null
  // When env create made it (ms); null for an orphan.
  created: number | null
  orphan: boolean
  ownerRun: string
}

function stackOf(raw: z.infer<typeof resultSchema>['stack']): RunEnvStack | null {
  if (!raw) {
    return null
  }
  const urls = Object.fromEntries(
    Object.entries(raw.urls ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
  return { kind: raw.kind, project: raw.project, urls, log: raw.log ?? null }
}

// env create's data (M4 §2.5). Every variable must be one Pilot may pass to a step: never PILOT_*, ORCA_*, PATH, …
export function parseEnvResult(data: unknown): EnvResult {
  const parsed = resultSchema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(
      `pilotcli env create's result doesn't fit the contract: ${issue.path.join('.')}: ${issue.message}`
    )
  }
  const vars = parsed.data.env ?? {}
  for (const name of Object.keys(vars)) {
    const problem = envNameProblem(name)
    if (problem) {
      throw new Error(
        `pilotcli env create returned a variable Pilot won't pass to steps: ${problem}`
      )
    }
  }
  return {
    mode: parsed.data.mode,
    reason: parsed.data.reason ?? '',
    path: parsed.data.path,
    sha: parsed.data.sha ?? null,
    envFile: parsed.data.env_file ?? null,
    vars,
    stack: stackOf(parsed.data.stack)
  }
}

function createdAt(raw: string | null | undefined): number | null {
  const at = raw ? Date.parse(raw) : Number.NaN
  return Number.isNaN(at) ? null : at
}

// env list's data: a list of rows. Anything else is refused, so the sweep does nothing.
export function parseEnvRows(data: unknown): EnvListRow[] {
  const parsed = rowsSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error("pilotcli env list didn't return a list of envs")
  }
  return parsed.data.map((row) => ({
    run: row.run,
    mode: row.mode ?? null,
    status: row.status ?? null,
    path: row.path ?? null,
    created: createdAt(row.created),
    orphan: row.orphan ?? false,
    ownerRun: row.owner_run ?? ''
  }))
}
