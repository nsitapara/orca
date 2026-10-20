import { z } from 'zod'
import { placeholderNames } from '../template'
import type { RawAutomation } from './schema'
import type { EnvStack, EnvStackSpec, EnvSubject, EnvWorkspaceDef, ItemKind } from './types'

export const ENV_STACKS = [
  'never',
  'backend',
  'full',
  'when_backend'
] as const satisfies readonly EnvStack[]

// workspace: { env: { … } } (M4 §8). Every key is optional here; envWorkspaceErrors says which combinations hold.
export const envWorkspaceSchema = z.strictObject({
  env: z.strictObject({
    worktree: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
    new_branch: z.string().min(1).optional(),
    at: z.string().min(1).optional(),
    from: z.string().min(1).optional(),
    keep: z.boolean().optional(),
    writes: z.boolean().optional(),
    // A literal (never, backend, full, when_backend) or one {field}: envWorkspaceErrors checks which.
    stack: z.string().min(1).optional()
  })
})
export type RawEnvWorkspace = z.infer<typeof envWorkspaceSchema>['env']

const SUBJECTS = ['worktree', 'branch', 'new_branch'] as const
const TEMPLATES = ['worktree', 'branch', 'new_branch', 'at', 'from'] as const
type KindOrRunOnce = ItemKind | 'run_once'

// The field prefixes each kind's items carry: its source's own (sources/*), worktree.* when its item has a
// worktree (fields/worktree-facts.ts; pipelines have none), repo.* and run.* for every run. A run-once
// automation's item is the repo, in its main checkout.
const KIND_PREFIXES: Record<KindOrRunOnce, readonly string[]> = {
  merge_request: ['mr', 'worktree', 'repo', 'run'],
  worktree: ['worktree', 'mr', 'repo', 'run'],
  linear_ticket: ['ticket', 'worktree', 'repo', 'run'],
  pipeline: ['pipeline', 'repo', 'run'],
  inbox_preparation: ['preparation', 'worktree', 'repo', 'run'],
  run_once: ['worktree', 'repo', 'run']
}

function rawEnvOf(raw: RawAutomation): RawEnvWorkspace | null {
  const ws = raw.workspace
  if (typeof ws === 'object' && 'env' in ws) {
    return ws.env
  }
  return null
}

function combinationErrors(env: RawEnvWorkspace): string[] {
  const named = SUBJECTS.filter((key) => env[key] !== undefined)
  if (named.length === 0) {
    return ['workspace.env: name one subject: worktree, branch (with at) or new_branch (with from)']
  }
  if (named.length > 1) {
    return [`workspace.env: ${named.join(', ')} are alternatives; name one`]
  }
  const errors: string[] = []
  if (env.branch !== undefined && env.at === undefined) {
    errors.push('workspace.env.branch needs at: the commit to check out')
  }
  if (env.new_branch !== undefined && env.from === undefined) {
    errors.push('workspace.env.new_branch needs from: the ref it starts from')
  }
  if (env.new_branch !== undefined && env.at !== undefined) {
    errors.push('workspace.env.at: only with worktree or branch')
  }
  if (env.new_branch === undefined && env.from !== undefined) {
    errors.push('workspace.env.from: only with new_branch')
  }
  if (env.new_branch === undefined && env.keep !== undefined) {
    errors.push('workspace.env.keep: only with new_branch')
  }
  return errors
}

function kindWords(kind: KindOrRunOnce): string {
  if (kind === 'run_once') {
    return 'a run-once automation'
  }
  return `${kind} items`
}

// A value is a template filled when the run starts: only fields its kind's items carry, never a step's.
function fieldErrors(key: string, template: string, kind: KindOrRunOnce): string[] {
  const where = `workspace.env.${key}`
  if (/\{[^{}]*\s[^{}]*\}/.test(template)) {
    return [`${where}: write placeholders without spaces, like {worktree.path}`]
  }
  const prefixes = KIND_PREFIXES[kind]
  return placeholderNames(template).flatMap((name) => {
    const prefix = name.split('.')[0]
    if (prefix === 'steps' || prefix === 'previous') {
      return [`${where}: {${name}} isn't known before a run starts`]
    }
    if (!name.includes('.') || !prefixes.includes(prefix)) {
      const have = prefixes.map((p) => `${p}.*`).join(', ')
      return [`${where}: {${name}} isn't a field of ${kindWords(kind)} (they have ${have})`]
    }
    return []
  })
}

export function envWorkspaceErrors(raw: RawAutomation): string[] {
  const env = rawEnvOf(raw)
  if (!env) {
    return []
  }
  const combinations = combinationErrors(env)
  if (combinations.length > 0) {
    return combinations
  }
  const kind: KindOrRunOnce = raw.items?.kind ?? 'run_once'
  const templates = TEMPLATES.flatMap((key) => {
    const value = env[key]
    return value === undefined ? [] : fieldErrors(key, value, kind)
  })
  return [...templates, ...stackErrors(env.stack, kind)]
}

// Exactly one placeholder and nothing else: {mr.stack}.
const SINGLE_FIELD = /^\{([a-z_][\w]*(?:\.[\w]+)+|[a-z_][\w]*)\}$/i

function isStack(value: string): value is EnvStack {
  return ENV_STACKS.some((stack) => stack === value)
}

// A literal must be one of the four (YAML spells when_backend with _). A field must be one the kind's items can have: its
// prefix decides, as for the subject, and a custom field (items.fields) carries its kind's prefix ({mr.stack}).
function stackErrors(stack: string | undefined, kind: KindOrRunOnce): string[] {
  if (stack === undefined || isStack(stack)) {
    return []
  }
  if (!SINGLE_FIELD.test(stack)) {
    return [
      `workspace.env.stack: "${stack}" isn't never, backend, full or when_backend, or a single {field} holding one`
    ]
  }
  return fieldErrors('stack', stack, kind)
}

function stackSpecOf(stack: string | undefined): EnvStackSpec {
  const field = stack === undefined ? undefined : SINGLE_FIELD.exec(stack)?.[1]
  if (field) {
    return { field }
  }
  return ENV_STACKS.find((known) => known === stack) ?? 'never'
}

function subjectOf(env: RawEnvWorkspace): EnvSubject {
  if (env.new_branch !== undefined) {
    return {
      kind: 'new_branch',
      newBranch: env.new_branch,
      from: env.from ?? '',
      keep: env.keep ?? false
    }
  }
  if (env.branch !== undefined) {
    return { kind: 'branch', branch: env.branch, at: env.at ?? '' }
  }
  return { kind: 'worktree', worktree: env.worktree ?? '', at: env.at ?? null }
}

export function normalizeEnvWorkspace(env: RawEnvWorkspace): EnvWorkspaceDef {
  return {
    kind: 'env',
    subject: subjectOf(env),
    writes: env.writes ?? false,
    stack: stackSpecOf(env.stack)
  }
}

// A detached session lives on in its tab, but an env's folder goes with its run's end.
export function waitStartErrors(raw: RawAutomation): string[] {
  if (!rawEnvOf(raw)) {
    return []
  }
  return raw.steps.flatMap((s, i) =>
    s.wait === 'start'
      ? [
          `step ${i + 1}: wait: start needs a workspace that outlives its run: an env is deleted when its run ends`
        ]
      : []
  )
}

// hold_home claims an env run's home for one shell step (its merge back). Other workspaces hold their worktree for the
// whole run (item_worktree, new_worktree) or share it by design (main_checkout).
export function holdHomeErrors(raw: RawAutomation): string[] {
  if (rawEnvOf(raw)) {
    return []
  }
  return raw.steps.flatMap((s, i) =>
    s.hold_home
      ? [
          `step ${i + 1}: hold_home: only with workspace: { env } (other workspaces hold their worktree for the whole run)`
        ]
      : []
  )
}
