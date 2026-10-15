import type { LinearWriteTargetRequest } from '../../../../shared/linear/agent-access'

// pilot.linear.commentEdit, behind `orca linear comment edit`: upstream Orca's Linear CLI can only add comments.
export type LinearCommentEditRequest = LinearWriteTargetRequest & {
  commentId: string
  body: string
}

export type LinearCommentEditResult = {
  comment: { id: string; url: string | null; parentId: string | null }
  issue: { id: string; identifier: string; url: string }
  meta: { workspaceId: string; bodyChars: number }
}
