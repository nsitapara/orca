import { z } from 'zod'

const percent = z
  .union([z.number(), z.string().regex(/^\d+(\.\d+)?%$/)])
  .transform((v) => (typeof v === 'number' ? v : Number(v.slice(0, -1))))

const peopleRef = z.union([
  z.literal('anyone'),
  z.strictObject({ people: z.array(z.string()).optional(), group: z.string().optional() })
])

const check = z.union([
  z.strictObject({ worktree: z.enum(['exists', 'clean']) }),
  z.strictObject({ session: z.literal('none_open') }),
  z.literal('quota'),
  z.strictObject({
    quota: z.strictObject({ weekly: percent.optional(), session: percent.optional() })
  }),
  z.strictObject({ check: z.string() })
])

const step = z.strictObject({
  name: z.string().optional(),
  agent: z.enum(['claude', 'codex', 'shell']),
  skill: z.string().optional(),
  mode: z.string().optional(),
  prompt: z.string().optional(),
  when: z.string().optional(),
  shell: z.string().optional()
})

export const automationSchema = z.strictObject({
  name: z.string().min(1),
  repo: z.string().min(1),
  schedule: z.string().min(1),
  timezone: z.string().optional(),
  enabled: z.boolean().optional(),
  items: z
    .strictObject({
      kind: z.string(),
      fields: z.record(z.string(), z.unknown()).optional(),
      where: z
        .strictObject({
          state: z.literal('open').optional(),
          author: peopleRef.optional(),
          head_pipeline: z.enum(['failed', 'any']).optional()
        })
        .optional()
    })
    .optional(),
  first_seen: z.enum(['process', 'baseline']).optional(),
  once_per: z.string().optional(),
  checks: z.array(check).optional(),
  limits: z
    .strictObject({
      per_tick: z.number().int().positive().optional(),
      at_once: z.number().int().positive().optional()
    })
    .optional(),
  start: z.enum(['auto', 'ask_first']).optional(),
  retry_after_failure: z.unknown().optional(),
  steps: z.array(step).min(1),
  answers: z.unknown().optional(),
  powers: z.array(z.string()).optional(),
  inbox: z.string().optional()
})

export type RawAutomation = z.infer<typeof automationSchema>
