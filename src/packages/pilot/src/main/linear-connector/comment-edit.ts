import { getClients } from '../../../../../main/linear/client'
import { linearError } from '../../../../../main/linear/issue-context-errors'
import { getCommentByUuidForAgent } from '../../../../../main/linear/linear-issue-lookups'
import {
  COMMENT_BY_UUID_QUERY,
  type LinearCommentByUuidResponse,
  type LinearRawVariables
} from '../../../../../main/linear/linear-issue-query-documents'
import {
  LinearWriteFailure,
  confirmLinearWrite,
  mapRawCommentWriteRecord,
  runLinearWrite,
  type LinearCommentWriteRecord
} from '../../../../../main/linear/linear-issue-write-support'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { LINEAR_WRITE_BODY_CAP } from '../../../../../shared/linear/agent-access'
import { isLinearUuid } from '../../../../../shared/linear/uuid'
import type {
  LinearCommentEditRequest,
  LinearCommentEditResult
} from '../../shared/api-types-linear'

// `orca linear comment edit`, built in Pilot from upstream's own Linear pieces (D24): the runtime's write
// target, write deadline, issue ref and read-failure mapping, and the client, write and read-back helpers.
type CommentEditRuntime = Pick<
  OrcaRuntimeService,
  | 'resolveLinearAgentWriteTarget'
  | 'runLinearAgentWrite'
  | 'mapLinearReadFailure'
  | 'notifyLinearLinkedIssueUpdated'
  | 'linearWriteIssueRef'
>

export type CommentEditDeps = {
  getComment: typeof getCommentByUuidForAgent
  updateComment: typeof updateCommentForAgent
}

export async function updateCommentForAgent(
  commentId: string,
  body: string,
  workspaceId: string,
  options: { signal?: AbortSignal } = {}
): Promise<LinearCommentWriteRecord> {
  const entry = getClients(workspaceId)[0]
  if (!entry) {
    throw new LinearWriteFailure('failed', 'Not connected to Linear')
  }
  return runLinearWrite(entry, options.signal, async (client) => {
    const result = await client.updateComment(commentId, { body })
    if (!result.success) {
      throw new LinearWriteFailure('failed', 'Failed to update comment')
    }
    // Why: Linear re-renders the stored markdown, so the read-back body need not equal the sent one.
    const record = await confirmLinearWrite(
      'Comment was updated but could not be retrieved',
      async () => {
        const read = await client.client.rawRequest<
          LinearCommentByUuidResponse,
          LinearRawVariables
        >(COMMENT_BY_UUID_QUERY, { id: commentId })
        const comment = read.data?.comment
        return comment ? mapRawCommentWriteRecord(comment) : null
      }
    )
    if (!record) {
      throw new LinearWriteFailure('unconfirmed', 'Comment was updated but could not be retrieved')
    }
    return record
  })
}

// invalid_argument crosses the RPC boundary with its data; a code of Pilot's own would arrive as runtime_error.
class CommentNotOnIssue extends Error {
  readonly code = 'invalid_argument'
  readonly data = {
    nextSteps: ['Run `orca linear issue <id> --comments --json` to list valid comment ids.']
  }

  constructor() {
    super('The comment is not on this issue.')
    this.name = 'CommentNotOnIssue'
  }
}

async function commentOnIssue(
  runtime: CommentEditRuntime,
  deps: CommentEditDeps,
  issueId: string,
  commentId: string,
  workspaceId: string
): Promise<LinearCommentWriteRecord> {
  if (!isLinearUuid(commentId)) {
    throw new CommentNotOnIssue()
  }
  let comment: LinearCommentWriteRecord | null
  try {
    comment = await deps.getComment(commentId, workspaceId)
  } catch (error) {
    throw runtime.mapLinearReadFailure(error)
  }
  if (!comment || comment.issue.id !== issueId) {
    throw new CommentNotOnIssue()
  }
  return comment
}

// Replaces a comment's whole body. The comment must be on the target issue, and Linear lets you edit
// only your own comments.
export async function editLinearComment(
  runtime: CommentEditRuntime,
  params: LinearCommentEditRequest,
  deps: CommentEditDeps = {
    getComment: getCommentByUuidForAgent,
    updateComment: updateCommentForAgent
  }
): Promise<LinearCommentEditResult> {
  if (params.body.length > LINEAR_WRITE_BODY_CAP) {
    throw linearError('linear_body_too_large', 'Linear comment body is too large.')
  }
  const target = await runtime.resolveLinearAgentWriteTarget(params)
  const existing = await commentOnIssue(
    runtime,
    deps,
    target.issue.id,
    params.commentId,
    target.workspaceId
  )
  const comment = await runtime.runLinearAgentWrite(
    (signal) => deps.updateComment(existing.id, params.body, target.workspaceId, { signal }),
    (cause) =>
      linearError(
        'linear_write_unconfirmed',
        'Linear may have applied the comment edit, but Pilot could not confirm it.',
        {
          nextSteps: [
            `Run \`orca linear issue ${target.issue.identifier} --comments --workspace ${target.workspaceId} --json\` and check comment ${existing.id} before retrying.`
          ],
          ...(cause ? { cause } : {})
        }
      )
  )
  await runtime.notifyLinearLinkedIssueUpdated(target.workspaceId, target.issue.identifier)
  return {
    comment: { id: comment.id, url: comment.url, parentId: comment.parentId },
    issue: runtime.linearWriteIssueRef(target.issue),
    meta: { workspaceId: target.workspaceId, bodyChars: params.body.length }
  }
}
