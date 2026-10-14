import type { RpcResponse } from '../runtime/rpc/core'
import type { RpcDispatcher } from '../runtime/rpc/dispatcher'
import {
  buildRemoteTargetRequest,
  call,
  readRemoteBody,
  requiredString,
  validateLinearRemoteArgs
} from './ssh-remote-linear-write-support'

type ParsedRemoteCli = {
  commandPath: string[]
  flags: Map<string, string | boolean>
}

const LINEAR_COMMENT_EDIT_FLAGS = new Set([
  'help',
  'json',
  'pairing-code',
  'environment',
  'workspace',
  'current',
  'id',
  'comment',
  'body',
  'body-file'
])

export async function dispatchRemoteLinearCommentEdit(
  dispatcher: RpcDispatcher,
  parsed: ParsedRemoteCli,
  env: Record<string, string>,
  stdin?: string
): Promise<RpcResponse> {
  validateLinearRemoteArgs(
    parsed,
    LINEAR_COMMENT_EDIT_FLAGS,
    ['linear', 'comment', 'edit'],
    1,
    'id'
  )
  return await call(dispatcher, 'linear.issueEditComment', {
    ...buildRemoteTargetRequest(parsed, env, 3),
    commentId: requiredString(parsed.flags, 'comment'),
    body: readRemoteBody(parsed.flags, true, stdin)
  })
}
