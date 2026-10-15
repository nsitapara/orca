import { defineMethod } from '../../../../../main/runtime/rpc/core'
import { LinearWriteTarget } from '../../../../../shared/rpc-contract/linear-agent-access-params'
import { requiredString } from '../../../../../shared/rpc-contract/rpc-param-primitives'
import { editLinearComment } from '../linear-connector/comment-edit'

const CommentEdit = LinearWriteTarget.extend({
  commentId: requiredString('Missing comment id'),
  body: requiredString('Missing comment body')
})

// Linear verbs upstream Orca's CLI lacks. They use only the runtime, so they work even when Pilot couldn't start.
export function buildLinearMethods() {
  return [
    defineMethod({
      name: 'pilot.linear.commentEdit',
      permission: 'workspace',
      params: CommentEdit,
      handler: (p, { runtime }) => editLinearComment(runtime, p)
    })
  ]
}
