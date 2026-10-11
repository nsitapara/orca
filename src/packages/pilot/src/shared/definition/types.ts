export type ItemKind = 'merge_request' | 'worktree' | 'pipeline' | 'linear_ticket'
export type PeopleSet = { people?: string[]; group?: string }
// `not` leaves out the people it names; everyone else (people.yaml or not) is in.
export type PeopleRef = 'anyone' | PeopleSet | { not: PeopleSet }

// items.where per kind (contract §3). Each has its schema in where.ts, which is also the kind's
// ItemSource.whereSchema, so validating a file and running it read the same rules.
export type MergeRequestWhere = {
  state?: 'open'
  author?: PeopleRef
  reviewer?: PeopleRef
  head_pipeline?: 'failed' | 'any'
  draft?: boolean
  approved_by?: 'none' | PeopleRef
  target_branch?: string
}
export type WorktreeWhere = {
  has_mr?: boolean
  mr_author?: PeopleRef
  mr_state?: 'open'
  branch_owner?: PeopleRef
}
export type PipelineWhere = {
  ref: string
  status?: 'failed' | 'any'
  select?: 'newest_complete' | 'newest_suite_running'
}
export type LinearTicketWhere = {
  assignee?: PeopleRef
  state_type?: string[]
  team?: string
  has_branch?: boolean
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
  // Always present in M1: run-once automations (no items:) arrive in M3.
  items: { kind: 'merge_request'; where: MergeRequestWhere }
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
