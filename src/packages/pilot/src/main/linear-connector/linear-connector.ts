import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import {
  LINEAR_CHILDREN_DEFAULT_DEPTH,
  type LinearAttachResult,
  type LinearCommentAddResult,
  type LinearCreateRequest,
  type LinearCreateResult,
  type LinearIssueListResult,
  type LinearIssueSummary,
  type LinearStatusSetResult
} from '../../../../../shared/linear/agent-access'

// The runtime's own Linear commands: what `orca linear …` reaches over RPC. In Pilot they read the
// Linear login kept in ~/.pilot (hook linear-credential-home), never Orca's ~/.orca.
export type LinearRuntime = Pick<
  OrcaRuntimeService,
  | 'linearIssueListForAgents'
  | 'linearIssueContext'
  | 'linearIssueCreate'
  | 'linearIssueAddComment'
  | 'linearIssueSetState'
  | 'linearIssueAttachLink'
>

export type LinearConnector = {
  listIssues(filter: 'assigned' | 'all'): Promise<LinearIssueListResult>
  issue(id: string, workspaceId?: string): Promise<LinearIssueSummary>
  create(req: LinearCreateRequest): Promise<LinearCreateResult>
  comment(req: {
    issue: string
    body: string
    workspaceId?: string
    writeId?: string
  }): Promise<LinearCommentAddResult>
  setState(req: { issue: string; to: string; workspaceId?: string }): Promise<LinearStatusSetResult>
  attach(req: {
    issue: string
    url: string
    title?: string
    workspaceId?: string
    writeId?: string
  }): Promise<LinearAttachResult>
}

// linear-todo-sweep LIST_LIMIT.
export const LINEAR_LIST_LIMIT = 200
const NO_INCLUDES = {
  comments: false,
  children: false,
  attachments: false,
  relations: false,
  activity: false
}

export function runtimeLinearConnector(runtime: LinearRuntime): LinearConnector {
  return {
    listIssues: (filter) =>
      runtime.linearIssueListForAgents({ filter, workspaceId: 'all', limit: LINEAR_LIST_LIMIT }),
    async issue(id, workspaceId) {
      const context = await runtime.linearIssueContext({
        input: id,
        current: false,
        ...(workspaceId ? { workspaceId } : {}),
        include: NO_INCLUDES,
        depth: LINEAR_CHILDREN_DEFAULT_DEPTH
      })
      return context.issue
    },
    create: (req) => runtime.linearIssueCreate(req),
    comment: ({ issue, body, workspaceId, writeId }) =>
      runtime.linearIssueAddComment({ input: issue, body, workspaceId, writeId }),
    setState: ({ issue, to, workspaceId }) =>
      runtime.linearIssueSetState({ input: issue, to, workspaceId }),
    attach: ({ issue, url, title, workspaceId, writeId }) =>
      runtime.linearIssueAttachLink({ input: issue, url, title, workspaceId, writeId })
  }
}

// linear-todo-sweep assigned_unstarted(): a listing that may be short (cut at the limit, more pages,
// a workspace that failed) is refused rather than read as "no more tickets".
export function incompleteListing(result: LinearIssueListResult): string | null {
  const { meta } = result
  if (result.truncated || meta.hasMore || meta.partial || meta.workspaceErrors.length > 0) {
    return `incomplete Linear listing, refusing to guess: ${JSON.stringify(meta)}`
  }
  return null
}
