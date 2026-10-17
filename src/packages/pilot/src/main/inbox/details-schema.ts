import { z } from 'zod'
import { DETAILS_LIMITS as LIMITS, type DetailsBundle, type ReviewFile } from '../../shared/details'

// The bundle's shape (details.py's docstring): the known fields and their types are checked, extra keys are
// kept, and every list is capped, so what the page draws is bounded whatever a job wrote.
export const BLOCK_TYPES = [
  'facts',
  'diff',
  'screens',
  'shots',
  'code',
  'thread',
  'text',
  'missing',
  'review',
  'report'
] as const

const text = z.string()
const maybeText = z.string().nullish()
const Ref = z
  .string()
  .max(LIMITS.refChars)
  .refine((ref) => !ref.includes('\0'), 'a file path has a NUL byte')
const Line = z.number().int().nullable()
const count = z.number().int().nonnegative()
const DiffRow = z.tuple([Line, Line, z.enum([' ', '+', '-']), text])
const list = <T extends z.ZodType>(item: T, max: number = LIMITS.listItems) =>
  z.array(item).max(max)

const Facts = z.looseObject({
  type: z.literal('facts'),
  title: maybeText,
  rows: list(z.tuple([text, text]))
})
const DiffFile = z.looseObject({
  path: text,
  old_path: maybeText,
  added: count.optional(),
  removed: count.optional(),
  hunks: z.array(z.array(DiffRow)),
  omitted: z.boolean().optional()
})
const Diff = z
  .looseObject({
    type: z.literal('diff'),
    title: maybeText,
    files: list(DiffFile, LIMITS.diffFiles),
    more_files: count.optional(),
    base: maybeText,
    head: maybeText,
    patch: Ref.nullish(),
    patch_kind: z.enum(['draft', 'committed']).optional(),
    patch_sha256: maybeText,
    checks: list(text).optional(),
    check_records: list(
      z.looseObject({
        command: text.min(1),
        exit_code: z.number().int(),
        output: Ref,
        output_sha256: text.regex(/^[a-f0-9]{64}$/),
        base: text.min(1),
        patch_sha256: text.regex(/^[a-f0-9]{64}$/)
      })
    ).optional()
  })
  .refine(
    (block) =>
      block.files.flatMap((f) => f.hunks).reduce((sum, hunk) => sum + hunk.length, 0) <=
      LIMITS.diffRows,
    `a diff block shows at most ${LIMITS.diffRows} rows`
  )
const Screens = z.looseObject({
  type: z.literal('screens'),
  title: maybeText,
  pairs: list(
    z.looseObject({
      before: Ref.nullish(),
      after: Ref.nullish(),
      caption: maybeText,
      route: maybeText,
      theme: maybeText,
      viewport: maybeText,
      note: maybeText
    })
  )
})
const Shots = z.looseObject({
  type: z.literal('shots'),
  title: maybeText,
  shots: list(z.looseObject({ file: Ref.nullish(), caption: maybeText }))
})
const Code = z.looseObject({
  type: z.literal('code'),
  title: maybeText,
  path: text,
  sha: maybeText,
  anchor: z.number().int().nullish(),
  rows: list(z.tuple([z.number().int(), text]), LIMITS.codeRows)
})
const Thread = z.looseObject({
  type: z.literal('thread'),
  title: maybeText,
  notes: list(z.looseObject({ author: maybeText, at: maybeText, body: maybeText })),
  url: maybeText
})
const Text = z.looseObject({ type: z.literal('text'), title: maybeText, body: text })
const Missing = z.looseObject({
  type: z.literal('missing'),
  title: maybeText,
  what: text,
  why: text,
  slot: maybeText,
  base: maybeText
})
const Review = z.looseObject({ type: z.literal('review'), title: maybeText, file: Ref })
const Report = z.looseObject({ type: z.literal('report'), title: maybeText, file: Ref })

export const BundleSchema: z.ZodType<DetailsBundle> = z
  .looseObject({
    version: z.literal(1),
    item: z
      .string()
      .max(200)
      .regex(/^[\w.-]+$/, 'the item id must be letters, digits, . _ or -'),
    built: maybeText,
    by: maybeText,
    provenance: z
      .object({
        originatingRunId: text.nullable(),
        preparingRunId: text.min(1),
        itemId: text.min(1),
        attempt: z.number().int().positive()
      })
      .optional(),
    blocks: list(
      z.discriminatedUnion('type', [
        Facts,
        Diff,
        Screens,
        Shots,
        Code,
        Thread,
        Text,
        Missing,
        Review,
        Report
      ]),
      LIMITS.blocks
    )
  })
  .refine(
    (bundle) => bundle.blocks.filter((b) => b.type === 'review').length <= LIMITS.reviews,
    `a bundle has at most ${LIMITS.reviews} review blocks`
  )

export const ReviewFileSchema: z.ZodType<ReviewFile> = z.looseObject({
  iid: z.number().int(),
  title: z.string().optional(),
  web_url: text,
  project: text,
  head_sha: text,
  reviewer: z.looseObject({ name: text, username: text }),
  parts: list(
    z.looseObject({
      id: text,
      hash: z.string().optional(),
      file: text,
      line: z.number().int().nullish(),
      side: maybeText,
      severity: maybeText,
      title: text,
      body: maybeText,
      in_diff: z.boolean(),
      comment: text,
      context: z.array(DiffRow).max(LIMITS.diffRows)
    })
  )
})

// The first problem zod found, as one line: where it is, and what is wrong.
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) {
    return 'it does not match the bundle shape'
  }
  const at = issue.path.map(String).join('.')
  return at ? `${at}: ${issue.message}` : issue.message
}
