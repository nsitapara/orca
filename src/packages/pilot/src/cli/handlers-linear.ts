import type { CommandHandler } from '../../../../cli/dispatch'
import { getRequiredStringFlag } from '../../../../cli/flags'
import { printResult } from '../../../../cli/format'
import { buildWriteTargetRequest, readLinearBody } from '../../../../cli/linear-request-builders'
import type { LinearCommentEditRequest, LinearCommentEditResult } from '../shared/api-types-linear'

// As long as upstream's other Linear writes wait.
const LINEAR_WRITE_TIMEOUT_MS = 75_000

export const LINEAR_HANDLERS: Record<string, CommandHandler> = {
  'linear comment edit': async ({ flags, client, cwd, json }) => {
    const commentId = getRequiredStringFlag(flags, 'comment')
    const body = await readLinearBody(flags, cwd, { required: true })
    const request: LinearCommentEditRequest = {
      ...buildWriteTargetRequest(flags, cwd, client.isRemote),
      commentId,
      body
    }
    const response = await client.call<LinearCommentEditResult>(
      'pilot.linear.commentEdit',
      request,
      {
        timeoutMs: LINEAR_WRITE_TIMEOUT_MS
      }
    )
    printResult(response, json, (r) => `Edited comment ${r.comment.id} on ${r.issue.identifier}.`)
  }
}
