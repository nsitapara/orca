import type { ItemFields } from '../api-types'
import type { EnvStack, EnvStackSpec, EnvSubject, EnvWorkspaceDef } from '../definition/types'
import { renderTemplate } from '../template'

// An env with everything filled in for one run: its subject rendered, its stack a stack.
export type ResolvedEnvWorkspace = Omit<EnvWorkspaceDef, 'stack'> & { stack: EnvStack }

// YAML says when_backend; pilotcli's flag value is when-backend (M4 §8).
const STACK_FLAG: Record<EnvStack, string> = {
  never: 'never',
  backend: 'backend',
  full: 'full',
  when_backend: 'when-backend'
}

function filled(template: string, fields: ItemFields, label: string): string {
  const { text, missing } = renderTemplate(template, fields)
  if (missing.length > 0) {
    const names = missing.map((name) => `{${name}}`).join(', ')
    throw new Error(`Can't prepare the workspace for ${label}: ${names} has no value`)
  }
  return text
}

// The subject with every template filled from the run's fields (the item's, then run.*). Throws, naming what's missing.
export function renderEnvSubject(
  subject: EnvSubject,
  fields: ItemFields,
  label: string
): EnvSubject {
  if (subject.kind === 'worktree') {
    const at = subject.at === null ? null : filled(subject.at, fields, label)
    return { kind: 'worktree', worktree: filled(subject.worktree, fields, label), at }
  }
  if (subject.kind === 'branch') {
    return {
      kind: 'branch',
      branch: filled(subject.branch, fields, label),
      at: filled(subject.at, fields, label)
    }
  }
  return {
    kind: 'new_branch',
    newBranch: filled(subject.newBranch, fields, label),
    from: filled(subject.from, fields, label),
    keep: subject.keep
  }
}

// What a stack field may hold when the run starts: the YAML spelling or pilotcli's flag spelling of when_backend.
const STACK_WORDS: Record<string, EnvStack> = {
  never: 'never',
  backend: 'backend',
  full: 'full',
  when_backend: 'when_backend',
  'when-backend': 'when_backend'
}

// The stack a run asks for: the literal, or the word its field holds now (a `fields: { script }` may fill it). An empty,
// missing or unknown value throws: the run fails before env create is called.
export function resolveEnvStack(spec: EnvStackSpec, fields: ItemFields): EnvStack {
  if (typeof spec === 'string') {
    return spec
  }
  const value = fields[spec.field]
  const text = value === null || value === undefined ? '' : String(value).trim()
  const stack = Object.hasOwn(STACK_WORDS, text) ? STACK_WORDS[text] : undefined
  if (!stack) {
    throw new Error(`stack resolved to '${text}', expected never|backend|full|when_backend`)
  }
  return stack
}

// The env for one run, filled from its fields (the item's, then run.*): subject first, then stack. Throws before anything
// is claimed or made.
export function resolveEnv(
  env: EnvWorkspaceDef,
  fields: ItemFields,
  label: string
): ResolvedEnvWorkspace {
  return {
    ...env,
    subject: renderEnvSubject(env.subject, fields, label),
    stack: resolveEnvStack(env.stack, fields)
  }
}

function subjectArgs(subject: EnvSubject): string[] {
  if (subject.kind === 'worktree') {
    const at = subject.at === null ? [] : ['--at', subject.at]
    return ['--worktree', subject.worktree, ...at]
  }
  if (subject.kind === 'branch') {
    return ['--branch', subject.branch, '--at', subject.at]
  }
  const keep = subject.keep ? ['--keep', 'true'] : []
  return ['--new-branch', subject.newBranch, '--from', subject.from, ...keep]
}

// A plain --worktree, the one subject Pilot holds before create and may pass --throwaway for. With --at, or any other
// subject, Pilot holds nothing beforehand, and the check after create (main/envs/prepare.ts) defers a run whose folder
// another run holds.
export function holdsWorktree(
  subject: EnvSubject
): subject is Extract<EnvSubject, { kind: 'worktree' }> & { at: null } {
  return subject.kind === 'worktree' && subject.at === null
}

// `env` is resolved (resolveEnv). `throwaway`: the reason another Pilot run holds the worktree (§8); pilotcli takes it
// only for a subject Pilot holds (holdsWorktree).
export function envCreateArgs(a: {
  runId: string
  env: ResolvedEnvWorkspace
  throwaway: string | null
  dryRun: boolean
}): string[] {
  const { subject } = a.env
  const args = ['env', 'create', '--run', a.runId, ...subjectArgs(subject)]
  if (a.env.writes) {
    args.push('--writes', 'true')
  }
  args.push('--stack', STACK_FLAG[a.env.stack])
  if (a.throwaway !== null && holdsWorktree(subject)) {
    args.push('--throwaway', a.throwaway)
  }
  if (a.dryRun) {
    args.push('--dry-run', 'true')
  }
  args.push('--format', 'json')
  return args
}

export function envDeleteArgs(runId: string, keepFolder: boolean): string[] {
  const keep = keepFolder ? ['--keep-folder', 'true'] : []
  return ['env', 'delete', runId, ...keep, '--format', 'json']
}

export const ENV_LIST_ARGS: readonly string[] = ['env', 'list', '--format', 'json']

// A run id as a file name (pid files), sanitized as pilotcli names its folders (M4 §2.1). Never used to match env list
// rows: their `run` is the id exactly as passed to create (Contract answers 4).
export function envRunKey(runId: string): string {
  return runId.toLowerCase().replace(/[^a-z0-9-]/g, '-')
}
