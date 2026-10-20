import type { EnvMode, EnvState, KeptHome, RunEnv, RunEnvStack } from '../../shared/api-types-env'

// What env_json holds beside the columns: the create command, who prepares it (a pid and its start identity, so a restart
// tells a stopped Pilot's preparation from a live one), and pilotcli's result.
export type EnvJson = {
  args?: string[]
  preparer?: { pid: number; identity: string | null }
  sha?: string | null
  envFile?: string | null
  vars?: Record<string, string>
  stack?: RunEnvStack | null
  // env delete's data.kept: the branch it kept a throwaway's unhomed commits on.
  kept?: string
  keptHome?: KeptHome
}

export function readEnvJson(raw: unknown): EnvJson {
  if (typeof raw !== 'string' || raw === '') {
    return {}
  }
  try {
    return JSON.parse(raw) as EnvJson
  } catch {
    return {}
  }
}

export function envOfRow(r: Record<string, unknown>): RunEnv | null {
  if (r.env_state === null || r.env_state === undefined) {
    return null
  }
  const json = readEnvJson(r.env_json)
  return {
    state: r.env_state as EnvState,
    mode: (r.env_mode as EnvMode | null) ?? null,
    reason: (r.env_reason as string | null) ?? null,
    path: (r.env_path as string | null) ?? null,
    sha: json.sha ?? null,
    envFile: json.envFile ?? null,
    vars: json.vars ?? {},
    stack: json.stack ?? null,
    removedAt: (r.env_removed_at as number | null) ?? null,
    deleteError: (r.env_delete_error as string | null) ?? null,
    deleteAttempts: Number(r.env_delete_attempts ?? 0),
    ...(json.kept ? { kept: json.kept } : {}),
    ...(json.keptHome ? { keptHome: json.keptHome } : {})
  }
}
