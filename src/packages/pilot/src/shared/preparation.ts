import { z } from 'zod'

export const PreparationInputSchema = z
  .object({
    key: z.string().trim().min(1).max(500),
    context: z
      .string()
      .trim()
      .min(1)
      .max(64 * 1024),
    requirements: z
      .array(z.enum(['context', 'diff', 'screens', 'checks', 'review']))
      .min(1)
      .max(5),
    maxAttempts: z.number().int().min(1).max(5).optional()
  })
  .strict()

export type PreparationInput = z.infer<typeof PreparationInputSchema>
export type PreparationRequirement = PreparationInput['requirements'][number]
export const InboxPreparationSchema = z.object({
  state: z.enum(['queued', 'generating', 'ready', 'blocked', 'cancelled']),
  input: PreparationInputSchema,
  revision: z.number().int().positive(),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  runId: z.string().nullable(),
  stepIdx: z.number().int().nonnegative().nullable(),
  leaseUntil: z.number().nullable(),
  progress: z.string(),
  error: z.string().nullable(),
  updatedAt: z.number()
})
export type InboxPreparation = z.infer<typeof InboxPreparationSchema>

export const PREPARATION_LEASE_MS = 10 * 60_000
export const PREPARATION_NOT_READY =
  'Context is still being prepared; generated changes cannot be approved yet'

export function queuedPreparation(input: PreparationInput, at: number): InboxPreparation {
  return {
    state: 'queued',
    input,
    revision: 1,
    attempt: 0,
    maxAttempts: input.maxAttempts ?? 3,
    runId: null,
    stepIdx: null,
    leaseUntil: null,
    progress: 'Context queued',
    error: null,
    updatedAt: at
  }
}
