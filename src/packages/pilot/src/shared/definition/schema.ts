import { z } from 'zod'
import { durationSchema } from './duration'
import type { AgentKind, ItemKind, Power } from './types'

export const ITEM_KINDS = [
  'merge_request',
  'worktree',
  'pipeline',
  'linear_ticket',
  'inbox_preparation'
] as const satisfies readonly ItemKind[]
export const AGENTS = ['claude', 'codex'] as const satisfies readonly AgentKind[]
export const POWERS = [
  'commit',
  'push',
  'post',
  'reply',
  'mark_ready',
  'create_ticket',
  'update_ticket',
  'remove_worktree',
  'close_session'
] as const satisfies readonly Power[]

const percent = z
  .union([z.number(), z.string().regex(/^\d+(\.\d+)?%$/)])
  .transform((v) => (typeof v === 'number' ? v : Number(v.slice(0, -1))))
const positiveInt = z.number().int().positive()

const check = z.union(
  [
    z.strictObject({ worktree: z.enum(['exists', 'clean', 'idle']) }),
    z.strictObject({
      session: z.union(
        [z.literal('none_open'), z.strictObject({ none_open: z.enum(['automation', 'any']) })],
        { error: 'expected none_open or { none_open: any }' }
      )
    }),
    z.literal('quota'),
    z.strictObject({
      quota: z.strictObject({
        agent: z.enum(AGENTS).optional(),
        weekly: percent.optional(),
        session: percent.optional()
      })
    }),
    z.strictObject({ mr: z.enum(['not_approved', 'not_merged', 'mine', 'not_draft']) }),
    z.strictObject({ window: z.string().regex(/^\d\d:\d\d-\d\d:\d\d$/, 'expected "HH:MM-HH:MM"') }),
    z.strictObject({ answers: z.literal('none_pending') }),
    z.strictObject({
      field: z.strictObject({ expr: z.string().min(1), reason: z.string().min(1) })
    }),
    z.strictObject({
      check: z.strictObject({ run: z.string().min(1), timeout: durationSchema.optional() })
    })
  ],
  {
    error: 'not a check Pilot knows (worktree, session, quota, mr, window, answers, field or check)'
  }
)

const customField = z.strictObject({
  script: z.string().min(1),
  cache: z.enum(['per_tick', 'per_head']).optional(),
  timeout: durationSchema.optional()
})

// items.where is a plain record here: parse.ts checks it with its kind's schema (where.ts).
const items = z.strictObject({
  kind: z.enum(ITEM_KINDS),
  where: z.record(z.string(), z.unknown()).optional(),
  match: z.array(z.string().min(1)).optional(),
  fields: z.record(z.string(), customField).optional()
})

const workspace = z.union(
  [
    z.enum(['item_worktree', 'main_checkout']),
    z.strictObject({
      new_worktree: z.strictObject({
        base: z.string().min(1),
        name: z.string().min(1),
        reuse_existing: z.boolean().optional(),
        // `run` runs the repo's worktree setup after creating it, the way `orca worktree create --setup run` does.
        setup: z.enum(['run', 'skip']).optional()
      })
    })
  ],
  { error: 'expected item_worktree, main_checkout or { new_worktree: { base, name } }' }
)

const stepSession = z.union(
  [z.enum(['new', 'per_worktree']), z.strictObject({ continue: z.string().min(1) })],
  { error: 'expected new, per_worktree or { continue: <step name> }' }
)

const step = z.strictObject({
  name: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, {
      error: (issue) =>
        `${String(issue.input)} must use only letters, digits and _ so {steps.<name>.…} can name it`
    })
    .optional(),
  agent: z.enum(['claude', 'codex', 'shell']),
  skill: z.string().min(1).optional(),
  mode: z.string().min(1).optional(),
  prompt: z.string().optional(),
  prompt_style: z.enum(['wrapped', 'raw']).optional(),
  args: z.array(z.string()).optional(),
  session: stepSession.optional(),
  run: z.string().min(1).optional(),
  env: z.record(z.string(), z.string()).optional(),
  exit_codes: z
    .strictObject({
      ok: z.array(z.number().int()).optional(),
      skip: z.array(z.number().int()).optional()
    })
    .optional(),
  when: z.string().min(1).optional(),
  always: z.boolean().optional(),
  timeout: durationSchema.optional()
})

const answers = z.strictObject({
  resume: z.enum(['asking_session', 'never']).optional(),
  else: z
    .strictObject({
      agent: z.enum(AGENTS),
      skill: z.string().min(1).optional(),
      mode: z.string().min(1).optional()
    })
    .optional()
})

// One stage of a job ported as several automations (13: open the ticket, then start its fix). `feeds` and
// `hands_over` only draw the arrows on the job's page; the loader checks the rules that span files (jobs.ts).
const job = z.strictObject({
  id: z.string({ error: 'expected the job id as text, quoted like "13"' }).min(1),
  name: z.string().min(1).optional(),
  stage: z.number().int().min(1, 'expected a whole number from 1'),
  label: z.string().min(1),
  feeds: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  hands_over: z.string().min(1).optional()
})

export const automationSchema = z.strictObject({
  name: z.string().min(1),
  repo: z.string().min(1),
  schedule: z.string().min(1),
  timezone: z.string().optional(),
  enabled: z.boolean().optional(),
  missed_run_grace: durationSchema.optional(),
  items: items.optional(),
  first_seen: z.enum(['process', 'baseline']).optional(),
  once_per: z.string().optional(),
  retry_after_failure: durationSchema.optional(),
  checks: z.array(check).optional(),
  limits: z
    .strictObject({
      per_tick: positiveInt.optional(),
      at_once: positiveInt.optional(),
      timeout: durationSchema.optional(),
      order: z.enum(['listed', 'oldest_waiting_first', 'priority']).optional()
    })
    .optional(),
  start: z.enum(['auto', 'ask_first']).optional(),
  ask_first: z
    .strictObject({
      title: z.string().min(1),
      context: z.string().optional(),
      options: z.array(z.string().min(1)).optional()
    })
    .optional(),
  workspace: workspace.optional(),
  steps: z.array(step).min(1),
  answers: answers.optional(),
  powers: z.array(z.enum(POWERS)).optional(),
  inbox: z.string().optional(),
  job: job.optional()
})

export type RawAutomation = z.infer<typeof automationSchema>
export type RawStep = RawAutomation['steps'][number]
export type RawCheck = NonNullable<RawAutomation['checks']>[number]
