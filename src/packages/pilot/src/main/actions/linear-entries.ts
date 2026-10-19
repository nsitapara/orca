import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { LinearWriter } from '../linear-connector/linear-writer'
import { imageArg, imageRefProblem, readTicketImages, withAssetUrls } from './linear-create-images'
import { createFailed, notCreated } from './linear-create-outcome'
import { actionDone, actionFailed, type ActionEntry, type ActionResult } from './types'

export const LINEAR_NOT_CONNECTED =
  "Linear isn't connected in Pilot; sign in to Linear in Pilot's settings"

// Where linear_create reads a card's screenshots from: the Automations folder (null: none).
export type LinearFiles = { detailsRoot: string | null }

// `orca linear --priority` names, in Linear's numeric order (0 none … 4 low).
const PRIORITY_NAMES = ['none', 'urgent', 'high', 'medium', 'low'] as const

// The write id Linear deduplicates a retried write on, derived from the attempt's key (the run, step and
// card that asked, the action and its args): the same attempt always gets the same id, never a random one.
// Shaped as a v4 uuid, the form Linear takes for a new entity's id.
export function writeIdFor(key: string): string {
  const hex = createHash('sha256').update(`pilot-linear-write\0${key}`).digest('hex')
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

// Only a v4 uuid: Linear refuses any other version as a new entity's id ("id must be a UUID").
const writeId = z.uuidv4({ error: 'must be a v4 uuid' }).optional()
const workspace = z.string().min(1).optional()
const httpUrl = z.string().regex(/^https?:\/\/\S+$/, 'an http(s) url')
const createArgs = z
  .strictObject({
    title: z.string().min(1),
    body: z.string().optional(),
    team: z.string().min(1),
    state: z.string().min(1).optional(),
    assignee: z.string().min(1).optional(),
    priority: z.union([z.number().int().min(0).max(4), z.enum(PRIORITY_NAMES)]).optional(),
    labels: z.array(z.string().min(1)).optional(),
    images: z.array(imageArg).optional(),
    links: z
      .array(z.strictObject({ url: httpUrl, title: z.string().min(1).optional() }))
      .optional(),
    workspace_id: workspace,
    write_id: writeId
  })
  .superRefine((a, ctx) => {
    const problem = imageRefProblem(a.body ?? '', a.images ?? [])
    if (problem) {
      ctx.addIssue({ code: 'custom', path: [problem.path], message: problem.message })
    }
  })
const commentArgs = z.strictObject({
  issue: z.string().min(1),
  body: z.string().min(1),
  workspace_id: workspace,
  write_id: writeId
})
const stateArgs = z.strictObject({
  issue: z.string().min(1),
  to: z.string().min(1),
  workspace_id: workspace
})
const attachArgs = z.strictObject({
  issue: z.string().min(1),
  url: httpUrl,
  title: z.string().min(1).optional(),
  workspace_id: workspace,
  write_id: writeId
})
type CreateArgs = z.infer<typeof createArgs>
type CommentArgs = z.infer<typeof commentArgs>
type StateArgs = z.infer<typeof stateArgs>
type AttachArgs = z.infer<typeof attachArgs>

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function priorityName(value: CreateArgs['priority']): string | undefined {
  return typeof value === 'number' ? PRIORITY_NAMES[value] : value
}

type Spec<A extends { write_id?: string; workspace_id?: string }> = {
  name: string
  power: 'create_ticket' | 'update_ticket'
  label: string
  usage: string
  schema: z.ZodType<A>
  // Whether the write carries a write id Linear deduplicates on (a state move carries none).
  pinned: boolean
  describe: (a: A) => string
  dry: (a: A) => string
  write: (linear: LinearWriter, a: A, writeId: string, files: LinearFiles) => Promise<ActionResult>
  // The data a refusal before the write carries.
  refused?: Record<string, string>
}

function counted(n: number, noun: string): string | null {
  if (n === 0) {
    return null
  }
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`
}

// " (2 screenshots, 1 link)", or nothing without either.
function attachments(a: CreateArgs): string {
  const parts = [
    counted(a.images?.length ?? 0, 'screenshot'),
    counted(a.links?.length ?? 0, 'link')
  ].filter((part) => part !== null)
  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}

// Attaches each link under its own write id; a failed one is noted in the detail, never fatal.
async function attachLinks(
  linear: LinearWriter,
  issue: string,
  a: CreateArgs,
  createId: string
): Promise<string> {
  let notes = ''
  for (const link of a.links ?? []) {
    try {
      await linear.attachUrl(issue, link.url, link.title ?? link.url, {
        workspaceId: a.workspace_id,
        writeId: writeIdFor(`${createId}\0link\0${link.url}`)
      })
    } catch (error) {
      notes += ` (MR link not attached: ${messageOf(error)})`
    }
  }
  return notes
}

// Screenshots are read and checked, then uploaded, before the create; links are attached after it.
async function createTicket(
  linear: LinearWriter,
  a: CreateArgs,
  id: string,
  files: LinearFiles
): Promise<ActionResult> {
  const read = readTicketImages(files.detailsRoot, a.images ?? [])
  if ('refused' in read) {
    return read.refused
  }
  const urls = new Map<string, string>()
  for (const image of read.images) {
    try {
      const uploaded = await linear.uploadImage({
        bytes: image.bytes,
        contentType: image.contentType,
        filename: image.filename,
        team: a.team,
        workspaceId: a.workspace_id
      })
      urls.set(image.ref, uploaded.assetUrl)
    } catch (error) {
      return notCreated('failed', `couldn't upload ${image.ref}: ${messageOf(error)}`)
    }
  }
  let made: Awaited<ReturnType<LinearWriter['createIssue']>>
  try {
    made = await linear.createIssue({
      team: a.team,
      title: a.title,
      body: withAssetUrls(a.body ?? '', urls),
      state: a.state,
      assignee: a.assignee,
      priority: priorityName(a.priority),
      labels: a.labels,
      workspaceId: a.workspace_id,
      writeId: id
    })
  } catch (error) {
    return createFailed(error, messageOf(error))
  }
  const notes = await attachLinks(linear, made.identifier, a, id)
  return actionDone(`created ${made.identifier}${notes}`, made.url, {
    identifier: made.identifier,
    branchName: made.branchName ?? '',
    url: made.url
  })
}

const create: Spec<CreateArgs> = {
  name: 'linear_create',
  power: 'create_ticket',
  label: 'Create a Linear ticket',
  usage:
    'linear_create { "title", "team", "body"?, "state"?, "assignee"?, "priority"?, "labels"?, "images"?: [{ "ref": "pilot-image:N", "path", "sha256", "caption"? }], "links"?: [{ "url", "title"? }], "workspace_id"?, "write_id"? }',
  schema: createArgs,
  pinned: true,
  describe: (a) => `Create a ${a.team} ticket: ${a.title}${attachments(a)}`,
  dry: (a) => `would create a ${a.team} ticket: ${a.title}${attachments(a)}`,
  write: createTicket,
  refused: { created: 'no' }
}

const comment: Spec<CommentArgs> = {
  name: 'linear_comment',
  power: 'update_ticket',
  label: 'Comment on a Linear ticket',
  usage: 'linear_comment { "issue", "body", "workspace_id"?, "write_id"? }',
  schema: commentArgs,
  pinned: true,
  describe: (a) => `Comment on ${a.issue}`,
  dry: (a) => `would comment on ${a.issue}`,
  write: async (linear, a, id) => {
    const made = await linear.addComment(a.issue, a.body, {
      workspaceId: a.workspace_id,
      writeId: id
    })
    return actionDone(`commented on ${a.issue}`, made.url)
  }
}

const setState: Spec<StateArgs> = {
  name: 'linear_set_state',
  power: 'update_ticket',
  label: 'Move a Linear ticket to another state',
  usage: 'linear_set_state { "issue", "to", "workspace_id"? }',
  schema: stateArgs,
  pinned: false,
  describe: (a) => `Move ${a.issue} to ${a.to}`,
  dry: (a) => `would move ${a.issue} to ${a.to}`,
  write: async (linear, a) => {
    await linear.setState(a.issue, a.to, { workspaceId: a.workspace_id })
    return actionDone(`${a.issue} → ${a.to}`)
  }
}

const attach: Spec<AttachArgs> = {
  name: 'linear_attach',
  power: 'update_ticket',
  label: 'Attach a link to a Linear ticket',
  usage: 'linear_attach { "issue", "url", "title"?, "workspace_id"?, "write_id"? }',
  schema: attachArgs,
  pinned: true,
  describe: (a) => `Attach ${a.title ?? a.url} to ${a.issue}`,
  dry: (a) => `would attach ${a.title ?? a.url} to ${a.issue}`,
  write: async (linear, a, id) => {
    await linear.attachUrl(a.issue, a.url, a.title ?? a.url, {
      workspaceId: a.workspace_id,
      writeId: id
    })
    return actionDone(`attached ${a.title ?? a.url} to ${a.issue}`, a.url)
  }
}

function usageProblem(spec: { usage: string }, error: z.ZodError): string {
  const why = error.issues.map((i) => `${i.path.join('.') || '(args)'}: ${i.message}`).join('; ')
  return `usage: ${spec.usage} (${why})`
}

function entryOf<A extends { write_id?: string; workspace_id?: string }>(
  spec: Spec<A>,
  linear: LinearWriter | null,
  files: LinearFiles
): ActionEntry {
  const refuse = (detail: string): ActionResult =>
    spec.refused ? { ...actionFailed(detail), data: { ...spec.refused } } : actionFailed(detail)
  const entry: ActionEntry = {
    name: spec.name,
    power: spec.power,
    label: spec.label,
    usage: spec.usage,
    checkArgs: (args) => {
      const parsed = spec.schema.safeParse(args)
      return parsed.success ? null : usageProblem(spec, parsed.error)
    },
    describe: async (args) => {
      const parsed = spec.schema.safeParse(args)
      return parsed.success ? spec.describe(parsed.data) : spec.usage
    },
    run: async (args, { dryRun }) => {
      const parsed = spec.schema.safeParse(args)
      if (!parsed.success) {
        return refuse(usageProblem(spec, parsed.error))
      }
      if (!linear) {
        return refuse(LINEAR_NOT_CONNECTED)
      }
      if (dryRun) {
        return actionDone(spec.dry(parsed.data))
      }
      const id = parsed.data.write_id
      if (spec.pinned && !id) {
        return refuse(
          `${spec.name} needs a write_id (Pilot pins one before it runs), so a retried write can't duplicate`
        )
      }
      try {
        return await spec.write(linear, parsed.data, id ?? '', files)
      } catch (error) {
        return actionFailed(messageOf(error))
      }
    }
  }
  if (spec.pinned) {
    entry.pin = (args, key) =>
      typeof args.write_id === 'string' ? args : { ...args, write_id: writeIdFor(key) }
  }
  return entry
}

// Bodies are inline in the args object (markdown), as `pilot action run --args-json` passes them.
export function linearEntries(
  linear: LinearWriter | null,
  files: LinearFiles = { detailsRoot: null }
): ActionEntry[] {
  return [
    entryOf(create, linear, files),
    entryOf(comment, linear, files),
    entryOf(setState, linear, files),
    entryOf(attach, linear, files)
  ]
}
