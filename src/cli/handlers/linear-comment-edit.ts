import type {
  LinearCommentEditRequest,
  LinearCommentEditResult
} from '../../shared/linear/agent-access'
import type { CommandHandler } from '../dispatch'
import { getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { formatLinearCommentEdit } from '../linear-format'
import { buildWriteTargetRequest, readLinearBody } from '../linear-request-builders'

const LINEAR_WRITE_TIMEOUT_MS = 75_000

export const linearCommentEditHandler: CommandHandler = async ({ flags, client, cwd, json }) => {
  const body = await readLinearBody(flags, cwd, { required: true })
  const request: LinearCommentEditRequest = {
    ...buildWriteTargetRequest(flags, cwd, client.isRemote),
    commentId: getRequiredStringFlag(flags, 'comment'),
    body
  }
  const response = await client.call<LinearCommentEditResult>('linear.issueEditComment', request, {
    timeoutMs: LINEAR_WRITE_TIMEOUT_MS
  })
  printResult(response, json, formatLinearCommentEdit)
}
