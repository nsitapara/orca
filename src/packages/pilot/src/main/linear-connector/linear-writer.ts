import {
  runtimeLinearConnector,
  type LinearConnector,
  type LinearRuntime
} from './linear-connector'

export type LinearWriteOpts = { workspaceId?: string; writeId?: string }

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
    writeId?: string
  }): Promise<{ identifier: string; url: string; branchName: string | null }>
  addComment(issue: string, body: string, opts?: LinearWriteOpts): Promise<{ url: string | null }>
  setState(issue: string, state: string, opts?: Pick<LinearWriteOpts, 'workspaceId'>): Promise<void>
  attachUrl(issue: string, url: string, title: string, opts?: LinearWriteOpts): Promise<void>
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

export function linearWriterOver(linear: LinearConnector): LinearWriter {
  return {
    async createIssue(input) {
      const created = await linear.create({
        title: input.title,
        body: input.body,
        teamInput: input.team,
        state: input.state,
        assignee: input.assignee,
        priority: priorityNumber(input.priority),
        labels: input.labels,
        workspaceId: input.workspaceId,
        writeId: input.writeId
      })
      const { identifier, url } = created.issue
      // sweep.py create_ticket: the branch name comes from reading the new issue back.
      const branchName = await linear
        .issue(identifier, created.meta.workspaceId)
        .then((issue) => issue.branchName ?? null)
        .catch(() => null)
      return { identifier, url, branchName }
    },
    async addComment(issue, body, opts) {
      const done = await linear.comment({
        issue,
        body,
        workspaceId: opts?.workspaceId,
        writeId: opts?.writeId
      })
      return { url: done.comment.url }
    },
    async setState(issue, state, opts) {
      await linear.setState({ issue, to: state, workspaceId: opts?.workspaceId })
    },
    async attachUrl(issue, url, title, opts) {
      await linear.attach({
        issue,
        url,
        title,
        workspaceId: opts?.workspaceId,
        writeId: opts?.writeId
      })
    }
  }
}

// The writer the action catalog uses: Pilot's Linear login (~/.pilot) through the runtime's own commands.
export function createLinearWriter(runtime: LinearRuntime): LinearWriter {
  return linearWriterOver(runtimeLinearConnector(runtime))
}
