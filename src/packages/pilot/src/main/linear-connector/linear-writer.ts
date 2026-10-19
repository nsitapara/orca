import { uploadLinearImage, type LinearImageUpload } from './file-upload'
import {
  runtimeLinearConnector,
  type LinearConnector,
  type LinearRuntime
} from './linear-connector'

// Linear deduplicates a retried write only by its writeId, so the non-idempotent writes require one.
export type LinearWriteOpts = { workspaceId?: string; writeId: string }

export type LinearWriter = {
  createIssue(input: {
    team: string
    title: string
    body: string
    state?: string
    assignee?: string
    priority?: string
    labels?: string[]
    workspaceId?: string
    writeId: string
  }): Promise<{ identifier: string; url: string; branchName: string | null }>
  addComment(issue: string, body: string, opts: LinearWriteOpts): Promise<{ url: string | null }>
  setState(issue: string, state: string, opts?: Pick<LinearWriteOpts, 'workspaceId'>): Promise<void>
  attachUrl(issue: string, url: string, title: string, opts: LinearWriteOpts): Promise<void>
  // The workspace that owns a team: the one named, else resolved as `orca linear create` resolves it.
  teamWorkspace(team: string, workspaceId?: string): Promise<string>
  uploadImage(input: LinearImageUpload): Promise<{ assetUrl: string }>
}

// `orca linear create --priority` names (src/cli/linear-request-builders.ts LINEAR_PRIORITY_VALUES).
const PRIORITY: Record<string, number> = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 }

function priorityNumber(name: string | undefined): number | undefined {
  if (name === undefined) {
    return undefined
  }
  if (!Object.hasOwn(PRIORITY, name)) {
    throw new Error(`unknown priority "${name}"`)
  }
  return PRIORITY[name]
}

function requireWriteId(writeId: string | undefined, what: string): string {
  if (typeof writeId !== 'string' || writeId === '') {
    throw new Error(`${what} needs a writeId, so a retried write can't duplicate`)
  }
  return writeId
}

export function linearWriterOver(
  linear: LinearConnector
): Omit<LinearWriter, 'teamWorkspace' | 'uploadImage'> {
  return {
    async createIssue(input) {
      const writeId = requireWriteId(input.writeId, 'creating a Linear issue')
      const created = await linear.create({
        title: input.title,
        body: input.body,
        teamInput: input.team,
        state: input.state,
        assignee: input.assignee,
        priority: priorityNumber(input.priority),
        labels: input.labels,
        workspaceId: input.workspaceId,
        writeId
      })
      const { identifier, url } = created.issue
      // sweep.py create_ticket: the branch name comes from reading the new issue back.
      const branchName = await linear
        .issue(identifier, created.meta.workspaceId)
        .then((issue) => issue.branchName ?? null)
        .catch((error: unknown) => {
          console.warn(`Linear: created ${identifier} but couldn't read its branch back:`, error)
          return null
        })
      return { identifier, url, branchName }
    },
    async addComment(issue, body, opts) {
      const writeId = requireWriteId(opts?.writeId, 'commenting on a Linear issue')
      const done = await linear.comment({
        issue,
        body,
        workspaceId: opts.workspaceId,
        writeId
      })
      return { url: done.comment.url }
    },
    async setState(issue, state, opts) {
      await linear.setState({ issue, to: state, workspaceId: opts?.workspaceId })
    },
    async attachUrl(issue, url, title, opts) {
      const writeId = requireWriteId(opts?.writeId, 'attaching a link to a Linear issue')
      await linear.attach({
        issue,
        url,
        title,
        workspaceId: opts.workspaceId,
        writeId
      })
    }
  }
}

// The catalog's writer: Pilot's Linear login (~/.pilot) through the runtime's own commands, plus image uploads.
export function createLinearWriter(
  runtime: LinearRuntime,
  upload: typeof uploadLinearImage = uploadLinearImage
): LinearWriter {
  return {
    ...linearWriterOver(runtimeLinearConnector(runtime)),
    async teamWorkspace(team, workspaceId) {
      return (
        workspaceId ?? (await runtime.resolveLinearCreateTeam(team, undefined, null)).workspaceId
      )
    },
    uploadImage: (input) => upload(input)
  }
}
