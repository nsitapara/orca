export type PeopleRef = 'anyone' | { people?: string[]; group?: string }

export type MergeRequestWhere = {
  state?: 'open'
  author?: PeopleRef
  head_pipeline?: 'failed' | 'any'
}

export type BuiltinCheck =
  | { kind: 'worktree_exists' }
  | { kind: 'worktree_clean' }
  | { kind: 'session_none_open' }
  | { kind: 'quota'; weekly: number; session: number }

export type StepDef = {
  name: string
  agent: 'claude' | 'codex'
  skill: string | null
  mode: string | null
  prompt: string
}

export type AutomationDefinition = {
  id: string
  file: string
  name: string
  repo: string
  schedule: string
  timezone: string
  enabled: boolean
  items: { kind: 'merge_request'; where: MergeRequestWhere } | null
  firstSeen: 'process' | 'baseline'
  oncePer: string | null
  checks: BuiltinCheck[]
  limits: { perTick: number | null; atOnce: number | null }
  steps: StepDef[]
  powers: string[]
  inbox: string
}

export type ParseResult =
  | { ok: true; definition: AutomationDefinition }
  | { ok: false; errors: string[] }
