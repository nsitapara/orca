import { z } from 'zod'
import type {
  ItemKind,
  LinearTicketWhere,
  MergeRequestWhere,
  PeopleRef,
  PipelineWhere,
  WorktreeWhere
} from './types'

const peopleSet = z.strictObject({
  people: z.array(z.string()).optional(),
  group: z.string().optional()
})

export const peopleRefSchema: z.ZodType<PeopleRef> = z.union(
  [z.literal('anyone'), peopleSet, z.strictObject({ not: peopleSet })],
  { error: 'expected anyone, { people: [...] }, { group: <id> } or { not: { people: [...] } }' }
)

export const mergeRequestWhereSchema: z.ZodType<MergeRequestWhere> = z.strictObject({
  state: z.literal('open').optional(),
  author: peopleRefSchema.optional(),
  reviewer: peopleRefSchema.optional(),
  head_pipeline: z.enum(['failed', 'any']).optional(),
  draft: z.boolean().optional(),
  approved_by: z
    .union([z.literal('none'), peopleRefSchema], {
      error:
        'expected none, anyone, { people: [...] }, { group: <id> } or { not: { people: [...] } }'
    })
    .optional(),
  target_branch: z.string().min(1).optional()
})

export const worktreeWhereSchema: z.ZodType<WorktreeWhere> = z.strictObject({
  has_mr: z.boolean().optional(),
  mr_author: peopleRefSchema.optional(),
  mr_state: z.literal('open').optional(),
  branch_owner: peopleRefSchema.optional(),
  commits: z
    .strictObject({
      ignore_trailer: z.string().min(1).optional(),
      first_sight: z.enum(['baseline', 'test_recent']).optional()
    })
    .optional()
})

export const pipelineWhereSchema: z.ZodType<PipelineWhere> = z
  .strictObject({
    ref: z.string().min(1),
    status: z.enum(['failed', 'any']).optional(),
    select: z.enum(['newest_complete', 'newest_suite_running']).optional(),
    source: z.string().min(1).optional(),
    marker_jobs: z.array(z.string().min(1)).min(1).optional()
  })
  .refine((w) => w.select !== 'newest_suite_running' || w.marker_jobs !== undefined, {
    message:
      'select: newest_suite_running needs marker_jobs (the jobs a pipeline that ran the suite always has)',
    path: ['marker_jobs']
  })

export const linearTicketWhereSchema: z.ZodType<LinearTicketWhere> = z.strictObject({
  assignee: peopleRefSchema.optional(),
  state_type: z.array(z.string().min(1)).optional(),
  team: z.string().min(1).optional(),
  has_branch: z.boolean().optional()
})

// The where block of each item kind. parse.ts checks a file with it; the kind's ItemSource uses the
// same object as its whereSchema. A new clause goes here and in the kind's source together.
export const WHERE_SCHEMAS: Record<ItemKind, z.ZodType> = {
  merge_request: mergeRequestWhereSchema,
  worktree: worktreeWhereSchema,
  pipeline: pipelineWhereSchema,
  linear_ticket: linearTicketWhereSchema,
  inbox_preparation: z.strictObject({})
}

// Every where clause that names people; the loader checks their ids against people.yaml.
export const PEOPLE_REF_CLAUSES = [
  'author',
  'reviewer',
  'approved_by',
  'mr_author',
  'branch_owner',
  'assignee'
] as const
