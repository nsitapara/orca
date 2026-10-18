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
      .array(z.enum(['context', 'diff', 'screens', 'checks']))
      .min(1)
      .max(4),
    maxAttempts: z.number().int().min(1).max(5).optional(),
    // The commit the card was made at: 14's env reads it as {preparation.head} (`at:`). Producers send it; Pilot sets it
    // only for a push card it queues itself (evidenceRequest), from the head that card pins.
    head: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/, 'expected a commit sha')
      .optional()
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
  // When the current attempt was claimed: its claim never holds past this plus PREPARATION_HOLD_MAX_MS.
  claimedAt: z.number().nullable().optional(),
  progress: z.string(),
  error: z.string().nullable(),
  updatedAt: z.number()
})
export type InboxPreparation = z.infer<typeof InboxPreparationSchema>

// What the Inbox list carries of a card's preparation (Ruling 2's light ref): where it stands and what it needs
// (`input.requirements`, the short needs summary). The request's context, up to 64 KB, comes with `pilot inbox show`
// (pilot.inbox.get) when a card asks for it. A full InboxPreparation is one of these too.
export type PreparationRef = Pick<
  InboxPreparation,
  'state' | 'revision' | 'attempt' | 'maxAttempts' | 'progress' | 'error' | 'updatedAt'
> & { input: Pick<PreparationInput, 'requirements'> }

export function preparationRef(p: InboxPreparation): PreparationRef {
  return {
    state: p.state,
    revision: p.revision,
    attempt: p.attempt,
    maxAttempts: p.maxAttempts,
    progress: p.progress,
    error: p.error,
    updatedAt: p.updatedAt,
    input: { requirements: [...p.input.requirements] }
  }
}

// Every refusal of a preparation request itself (its shape, its size) starts with this, so the bridge can tell it
// from any other refusal and fall back to a "Not prepared" card (D2) only then.
export const PREPARATION_REFUSED = 'Preparation request refused'
export const notPreparedReply = (reason: string): string => `Not prepared: ${reason}`

export const PREPARATION_LEASE_MS = 10 * 60_000
// The hard cap on one attempt's claim: past it the claim has expired even while its step still reports running.
export const PREPARATION_HOLD_MAX_MS = 3 * 60 * 60_000
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

// Back in the queue for a fresh attempt (an undone early answer, a person's Retry): a new
// revision voids every claim on the old one, and the attempts start over. The old worker's run stays named, so a new
// one never starts beside it while it still runs.
export function requeuedPreparation(p: InboxPreparation, at: number): InboxPreparation {
  return {
    ...p,
    state: 'queued',
    revision: p.revision + 1,
    attempt: 0,
    leaseUntil: null,
    progress: 'Context queued',
    error: null,
    updatedAt: at
  }
}
