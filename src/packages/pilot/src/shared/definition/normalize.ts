import { normalizeEnvWorkspace } from './env-workspace'
import type { RawAutomation, RawCheck, RawJob, RawStep } from './schema'
import type {
  AgentKind,
  AnswersDef,
  AutomationDefinition,
  CheckDef,
  FeedDef,
  ItemsDef,
  JobDef,
  StepDef,
  StepSession,
  WorkspaceDef
} from './types'

const HOUR_MS = 3_600_000
export const DEFAULT_SCRIPT_TIMEOUT_MS = 60_000

// Platform-neutral (R1): no Node built-in imports. Same result as basename(file, extname(file)) for .yaml/.yml.
export function idFromFile(file: string): string {
  return file
    .split('/')
    .pop()!
    .replace(/\.ya?ml$/, '')
}

// A step's name as {steps.<name>.…} reads it: its own, or step<N> (1-based).
export function stepNames(steps: { name?: string }[]): string[] {
  return steps.map((s, i) => s.name ?? `step${i + 1}`)
}

// A quota check without agent: reads the quota of the agent the steps use (Claude for shell-only runs).
function stepsAgent(raw: RawAutomation): AgentKind {
  const agentStep = raw.steps.find((s) => s.agent !== 'shell')
  if (agentStep?.agent === 'codex') {
    return 'codex'
  }
  return 'claude'
}

function normalizeCheck(c: RawCheck, agent: AgentKind): CheckDef {
  if (c === 'quota') {
    return { kind: 'quota', agent, weekly: 90, session: 95 }
  }
  // validate.ts refuses worktree: clean and idle before normalize runs.
  if ('worktree' in c) {
    return { kind: 'worktree_exists' }
  }
  if ('session' in c) {
    return {
      kind: 'session_none_open',
      scope: c.session === 'none_open' ? 'automation' : c.session.none_open
    }
  }
  if ('quota' in c) {
    return {
      kind: 'quota',
      agent: c.quota.agent ?? agent,
      weekly: c.quota.weekly ?? 90,
      session: c.quota.session ?? 95
    }
  }
  if ('mr' in c) {
    return { kind: 'mr', rule: c.mr }
  }
  if ('window' in c) {
    const [start, end] = c.window.split('-')
    return { kind: 'window', start, end }
  }
  if ('answers' in c) {
    return { kind: 'answers_none_pending' }
  }
  if ('field' in c) {
    return { kind: 'field', expr: c.field.expr, reason: c.field.reason }
  }
  return {
    kind: 'script',
    run: c.check.run,
    timeoutMs: c.check.timeout ?? DEFAULT_SCRIPT_TIMEOUT_MS
  }
}

function normalizeSession(session: RawStep['session']): StepSession {
  if (session === undefined || session === 'new') {
    return { kind: 'new' }
  }
  if (session === 'per_worktree') {
    return { kind: 'per_worktree' }
  }
  return { kind: 'continue', step: session.continue }
}

function normalizeStep(s: RawStep, name: string): StepDef {
  return {
    name,
    agent: s.agent,
    skill: s.skill ?? null,
    mode: s.mode ?? null,
    prompt: s.prompt ?? null,
    promptStyle: s.prompt_style ?? 'wrapped',
    args: s.args ?? [],
    session: normalizeSession(s.session),
    run: s.run ?? null,
    env: s.env ?? {},
    exitCodes: {
      ok: s.exit_codes?.ok ?? [0],
      skip: s.exit_codes?.skip ?? [],
      stop: s.exit_codes?.stop ?? []
    },
    when: s.when ?? null,
    always: s.always ?? false,
    timeoutMs: s.timeout ?? null,
    outputs: s.outputs ?? [],
    holdHome: s.hold_home ?? false
  }
}

function normalizeWorkspace(raw: RawAutomation): WorkspaceDef {
  const workspace = raw.workspace ?? (raw.items ? 'item_worktree' : 'main_checkout')
  if (workspace === 'item_worktree') {
    return { kind: 'item_worktree' }
  }
  if (workspace === 'main_checkout') {
    return { kind: 'main_checkout' }
  }
  if ('env' in workspace) {
    return normalizeEnvWorkspace(workspace.env)
  }
  const created = workspace.new_worktree
  return {
    kind: 'new_worktree',
    base: created.base,
    name: created.name,
    reuseExisting: created.reuse_existing ?? false,
    setup: created.setup ?? 'skip'
  }
}

function normalizeItems(raw: RawAutomation, where: Record<string, unknown>): ItemsDef | null {
  if (!raw.items) {
    return null
  }
  return {
    kind: raw.items.kind,
    where,
    match: raw.items.match ?? [],
    customFields: Object.entries(raw.items.fields ?? {}).map(([name, f]) => ({
      name,
      script: f.script,
      cache: f.cache ?? 'per_tick',
      timeoutMs: f.timeout ?? DEFAULT_SCRIPT_TIMEOUT_MS
    }))
  }
}

function normalizeAnswers(raw: RawAutomation): AnswersDef | null {
  const answers = raw.answers
  if (!answers) {
    return null
  }
  const fallback = answers.else
    ? {
        agent: answers.else.agent,
        skill: answers.else.skill ?? null,
        mode: answers.else.mode ?? null
      }
    : null
  const stack = answers.stack === undefined ? {} : { stack: answers.stack }
  return { resume: answers.resume ?? 'asking_session', ...stack, else: fallback }
}

// `where` is items.where after its kind's schema (parse.ts); {} for a run-once automation.
export function normalize(
  raw: RawAutomation,
  file: string,
  where: Record<string, unknown>
): AutomationDefinition {
  const agent = stepsAgent(raw)
  const names = stepNames(raw.steps)
  return {
    id: idFromFile(file),
    file,
    name: raw.name,
    repo: raw.repo,
    schedule: raw.schedule,
    timezone: raw.timezone ?? 'America/Los_Angeles',
    enabled: raw.enabled ?? true,
    missedRunGraceMs: raw.missed_run_grace ?? HOUR_MS,
    items: normalizeItems(raw, where),
    firstSeen: raw.first_seen ?? 'process',
    oncePer: raw.once_per ?? null,
    retryAfterFailureMs: raw.retry_after_failure ?? null,
    checks: (raw.checks ?? []).map((c) => normalizeCheck(c, agent)),
    limits: {
      perTick: raw.limits?.per_tick ?? null,
      atOnce: raw.limits?.at_once ?? null,
      timeoutMs: raw.limits?.timeout ?? null,
      order: raw.limits?.order ?? 'listed'
    },
    start: raw.start ?? 'auto',
    askFirst: raw.ask_first
      ? {
          title: raw.ask_first.title,
          context: raw.ask_first.context ?? '',
          options: raw.ask_first.options ?? []
        }
      : null,
    workspace: normalizeWorkspace(raw),
    steps: raw.steps.map((s, i) => normalizeStep(s, names[i])),
    answers: normalizeAnswers(raw),
    powers: raw.powers ?? [],
    inbox: raw.inbox ?? '{mr.author}',
    runsOn: raw.runs_on ?? null,
    job: normalizeJob(raw)
  }
}

// job.feeds as connections. A name (the old shape, alone or in the list) is an arrow only, captioned by hands_over.
export function feedsOf(job: RawJob): FeedDef[] {
  const raw = job.feeds ?? []
  const entries = typeof raw === 'string' ? [raw] : raw
  return entries.map((entry) => {
    if (typeof entry === 'string') {
      return {
        to: entry,
        pass: null,
        run: 'next_schedule',
        when: 'success',
        caption: job.hands_over ?? null,
        trust: 'shell'
      }
    }
    return {
      to: entry.to,
      pass: entry.pass ? { id: entry.pass.id } : null,
      run: entry.run ?? 'next_schedule',
      when: entry.when ?? 'success',
      caption: entry.caption ?? null,
      trust: entry.trust ?? 'shell'
    }
  })
}

function normalizeJob(raw: RawAutomation): JobDef | null {
  const job = raw.job
  if (!job) {
    return null
  }
  return {
    id: job.id,
    name: job.name ?? null,
    stage: job.stage,
    label: job.label,
    feeds: feedsOf(job)
  }
}
