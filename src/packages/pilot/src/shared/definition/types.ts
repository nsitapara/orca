export type ItemKind =
  | 'merge_request'
  | 'worktree'
  | 'pipeline'
  | 'linear_ticket'
  | 'inbox_preparation'
  | 'kept_branch'
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
export type WorktreeCommits = {
  ignore_trailer?: string
  first_sight?: 'baseline' | 'test_recent'
  paths?: string[]
}
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
  source?: string
  marker_jobs?: string[]
}
// where.ids_from: the ids the source reads instead of listing. `run` is a command (plain words, no shell) printing them;
// `feed: true` adds the ids an earlier stage of the job handed over (job.feeds … pass). With both, their union.
export type IdsFrom = {
  feed?: boolean
  run?: string
  field?: string
  env?: Record<string, string>
  timeout?: string
}
// ids_from's command half, once it has one.
export type IdsCommandSpec = IdsFrom & { run: string }
export type LinearTicketWhere = {
  ids_from?: IdsFrom
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
  | { kind: 'session_none_open'; scope: 'automation' | 'any' }
  | { kind: 'quota'; agent: AgentKind; weekly: number; session: number }
  | { kind: 'mr'; rule: 'not_approved' | 'not_merged' | 'mine' | 'not_draft' }
  | { kind: 'window'; start: string; end: string }
  | { kind: 'answers_none_pending' }
  // kept_branch items: the merge can land now (kept.wait is empty).
  | { kind: 'kept_ready' }
  | { kind: 'field'; expr: string; reason: string }
  | { kind: 'script'; run: string; timeoutMs: number }

export type EnvStack = 'never' | 'backend' | 'full' | 'when_backend'
// workspace: { env } (pilotcli M4 §8): one subject, its values templates rendered when the run starts.
export type EnvSubject =
  | { kind: 'worktree'; worktree: string; at: string | null }
  | { kind: 'branch'; branch: string; at: string }
  | { kind: 'new_branch'; newBranch: string; from: string; keep: boolean }
// A literal stack, or the one item field that holds it (stack: "{mr.stack}"), read when the run starts.
export type EnvStackSpec = EnvStack | { field: string }
export type EnvWorkspaceDef = {
  kind: 'env'
  subject: EnvSubject
  writes: boolean
  stack: EnvStackSpec
}

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
  | EnvWorkspaceDef

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
  // `start`: an agent step ends once its session is up, and the session goes on in its tab.
  wait: 'start' | 'finish'
  args: string[]
  session: StepSession
  run: string | null
  exitCodes: { ok: number[]; skip: number[]; stop: number[] }
  // Shell steps: NAME -> template, rendered as plain text and exported to the command.
  env: Record<string, string>
  when: string | null
  always: boolean
  timeoutMs: number | null
  // The outputs it declares (outputs: [ticket]): a job.feeds pass may hand on only these.
  outputs: string[]
  // hold_home: Pilot's claim on an env run's home for this shell step. Optional so hand-built StepDefs stay valid;
  // normalize always sets it.
  holdHome?: boolean
}

export type AnswersDef = {
  resume: 'asking_session' | 'never'
  // never: an answer run keeps the job's env rules but starts no stack. Absent otherwise.
  stack?: 'never'
  else: { agent: AgentKind; skill: string | null; mode: string | null } | null
}

export type FeedRun = 'now' | 'next_schedule'
export type FeedWhen = 'success' | 'always'
// One connection of job.feeds, to another stage of the same job. `pass` hands that stage item ids from this run's
// outputs (pass.id names the output); `run: now` ticks it as soon as this run ends, `next_schedule` leaves the ids for
// its own schedule. `when`: on a successful run only (done or needs you), or on any end. A connection without pass
// and without run: now is the arrow on the job's page only (the old `feeds: <name>`). `trust`: whose declared outputs
// pass may read: shell steps only (the default), or agent steps too (trust: agent).
export type FeedDef = {
  to: string
  pass: { id: string } | null
  run: FeedRun
  when: FeedWhen
  caption: string | null
  trust: 'shell' | 'agent'
}

// job: (schema.ts). A stage of a job of several automations; null: the automation is a job of its own.
export type JobDef = {
  id: string
  // The job's display name; at least one stage sets it, and all that do agree (jobs.ts).
  name: string | null
  stage: number
  label: string
  // The stages it hands work to, each with its arrow's caption.
  feeds: FeedDef[]
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
  // never: past the retry limit the runner keeps retrying, further apart, and leaves no give-up card.
  giveUp: 'after_retries' | 'never'
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
  // runs_on: the one machine this job runs on (its machine name); null: any machine.
  runsOn: string | null
  job: JobDef | null
}

export type ParseResult =
  | { ok: true; definition: AutomationDefinition }
  | { ok: false; errors: string[] }
