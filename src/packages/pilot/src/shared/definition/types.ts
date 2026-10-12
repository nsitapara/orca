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
export type WorktreeCommits = { ignore_trailer?: string; first_sight?: 'baseline' | 'test_recent' }
export type WorktreeWhere = {
  has_mr?: boolean
  mr_author?: PeopleRef
  mr_state?: 'open'
  branch_owner?: PeopleRef
  commits?: WorktreeCommits
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

export type AgentKind = 'claude' | 'codex'
export type StepAgent = AgentKind | 'shell'
export type Power =
  | 'commit'
  | 'push'
  | 'post'
  | 'reply'
  | 'mark_ready'
  | 'create_ticket'
  | 'update_ticket'
  | 'remove_worktree'
  | 'close_session'

export type ItemsDef = {
  kind: ItemKind
  // The where block after its kind's schema (where.ts); the kind's item source reads it.
  where: Record<string, unknown>
  match: string[]
  customFields: {
    name: string
    script: string
    cache: 'per_tick' | 'per_head'
    timeoutMs: number
  }[]
}

export type CheckDef =
  | { kind: 'worktree_exists' }
  | { kind: 'worktree_clean' }
  | { kind: 'worktree_idle' }
  | { kind: 'session_none_open'; scope: 'automation' | 'any' }
  | { kind: 'quota'; agent: AgentKind; weekly: number; session: number }
  | { kind: 'mr'; rule: 'not_approved' | 'not_merged' | 'mine' | 'not_draft' }
  | { kind: 'window'; start: string; end: string }
  | { kind: 'answers_none_pending' }
  | { kind: 'field'; expr: string; reason: string }
  | { kind: 'script'; run: string; timeoutMs: number }

export type WorkspaceDef =
  | { kind: 'item_worktree' }
  | { kind: 'main_checkout' }
  | {
      kind: 'new_worktree'
      base: string
      name: string
      reuseExisting: boolean
      setup: 'run' | 'skip'
    }

export type StepSession =
  | { kind: 'new' }
  | { kind: 'continue'; step: string }
  | { kind: 'per_worktree' }

export type StepDef = {
  name: string
  agent: StepAgent
  skill: string | null
  mode: string | null
  prompt: string | null
  promptStyle: 'wrapped' | 'raw'
  args: string[]
  session: StepSession
  run: string | null
  exitCodes: { ok: number[]; skip: number[] }
  // Shell steps: NAME -> template, rendered as plain text and exported to the command.
  env: Record<string, string>
  when: string | null
  always: boolean
  timeoutMs: number | null
}

export type AnswersDef = {
  resume: 'asking_session' | 'never'
  else: { agent: AgentKind; skill: string | null; mode: string | null } | null
}

export type AutomationDefinition = {
  id: string
  file: string
  name: string
  repo: string
  schedule: string
  timezone: string
  enabled: boolean
  missedRunGraceMs: number
  items: ItemsDef | null // null = run-once
  firstSeen: 'process' | 'baseline'
  oncePer: string | null
  retryAfterFailureMs: number | null
  checks: CheckDef[]
  limits: {
    perTick: number | null
    atOnce: number | null
    timeoutMs: number | null
    order: 'listed' | 'oldest_waiting_first' | 'priority'
  }
  start: 'auto' | 'ask_first'
  // options are "<label> — <meaning>" pairs for the card's buttons; [] means Approve / Skip (G4).
  askFirst: { title: string; context: string; options: string[] } | null
  workspace: WorkspaceDef
  steps: StepDef[]
  answers: AnswersDef | null
  powers: Power[]
  inbox: string
}

export type ParseResult =
  | { ok: true; definition: AutomationDefinition }
  | { ok: false; errors: string[] }
