import { afterEach, describe, expect, it, vi } from 'vitest'
import { LINEAR_WRITE_BODY_CAP } from '../../../../../shared/linear/agent-access'
import type * as LinearClientModule from '../../../../../main/linear/client'

const mocks = vi.hoisted(() => ({ getClients: vi.fn() }))

vi.mock('../../../../../main/linear/linear-request-concurrency', () => ({
  acquire: vi.fn().mockResolvedValue(undefined),
  release: vi.fn()
}))

vi.mock('../../../../../main/linear/linear-token-store', () => ({ clearToken: vi.fn() }))

vi.mock('../../../../../main/linear/client', async (importOriginal) => ({
  ...(await importOriginal<typeof LinearClientModule>()),
  getClients: mocks.getClients,
  isAuthError: () => false
}))

import { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { editLinearComment, updateCommentForAgent, type CommentEditDeps } from './comment-edit'

const COMMENT_ID = '11111111-1111-4111-8111-111111111111'
const COMMENT_URL = 'https://linear.app/acme/issue/ENG-1#comment-1'
const issue = { id: 'issue-1', identifier: 'ENG-1', url: 'https://linear.app/acme/issue/ENG-1' }

function commentOn(issueId: string, body = 'Old') {
  return {
    id: COMMENT_ID,
    url: COMMENT_URL,
    body,
    issue: { ...issue, id: issueId },
    parentId: null,
    threadRootId: COMMENT_ID
  }
}

function connectWithReadback(comment: unknown): { updateComment: ReturnType<typeof vi.fn> } {
  const updateComment = vi.fn().mockResolvedValue({ success: true })
  const rawRequest = vi.fn().mockResolvedValue({ data: { comment } })
  mocks.getClients.mockReturnValue([
    { workspace: { id: 'workspace-1' }, client: { updateComment, client: { rawRequest } } }
  ])
  return { updateComment }
}

// The runtime's own write guard, issue ref and read-failure mapping; only the issue lookup and the
// linked-issue notice are stubbed.
function runtimeTargetingIssue() {
  const runtime = new OrcaRuntimeService()
  const notify = vi.fn().mockResolvedValue(undefined)
  Object.assign(runtime, {
    resolveLinearAgentWriteTarget: vi.fn().mockResolvedValue({ issue, workspaceId: 'workspace-1' }),
    notifyLinearLinkedIssueUpdated: notify
  })
  return { runtime, notify }
}

function deps(found: unknown): CommentEditDeps & {
  getComment: ReturnType<typeof vi.fn>
  updateComment: ReturnType<typeof vi.fn>
} {
  return {
    getComment: vi.fn().mockResolvedValue(found),
    updateComment: vi.fn().mockResolvedValue(commentOn('issue-1', 'New'))
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('updateCommentForAgent', () => {
  it('sends the new body and returns the comment Linear reads back', async () => {
    const { updateComment } = connectWithReadback({
      id: COMMENT_ID,
      url: COMMENT_URL,
      body: 'New',
      parent: null,
      issue
    })

    await expect(updateCommentForAgent(COMMENT_ID, 'New', 'workspace-1')).resolves.toEqual({
      id: COMMENT_ID,
      url: COMMENT_URL,
      body: 'New',
      issue,
      parentId: null,
      threadRootId: COMMENT_ID
    })
    expect(updateComment).toHaveBeenCalledWith(COMMENT_ID, { body: 'New' })
  })

  it('treats a read-back miss after the update as unconfirmed', async () => {
    connectWithReadback(null)

    await expect(updateCommentForAgent(COMMENT_ID, 'New', 'workspace-1')).rejects.toMatchObject({
      kind: 'unconfirmed'
    })
  })
})

describe('editLinearComment', () => {
  it.each([
    { name: 'a comment on another issue', commentId: COMMENT_ID, found: commentOn('issue-2') },
    { name: 'a comment Linear cannot find', commentId: COMMENT_ID, found: null },
    { name: 'a comment id that is not a UUID', commentId: 'comment-1', found: commentOn('issue-1') }
  ])('refuses $name without writing', async ({ commentId, found }) => {
    const d = deps(found)
    const { runtime } = runtimeTargetingIssue()

    await expect(
      editLinearComment(runtime, { input: 'ENG-1', commentId, body: 'New' }, d)
    ).rejects.toMatchObject({
      code: 'invalid_argument',
      message: 'The comment is not on this issue.'
    })
    expect(d.updateComment).not.toHaveBeenCalled()
  })

  it('refuses an oversized body before resolving the issue', async () => {
    const d = deps(commentOn('issue-1'))
    const { runtime } = runtimeTargetingIssue()

    await expect(
      editLinearComment(
        runtime,
        { input: 'ENG-1', commentId: COMMENT_ID, body: 'x'.repeat(LINEAR_WRITE_BODY_CAP + 1) },
        d
      )
    ).rejects.toMatchObject({ code: 'linear_body_too_large' })
    expect(d.getComment).not.toHaveBeenCalled()
  })

  it('replaces the body of a comment on the issue', async () => {
    const d = deps(commentOn('issue-1'))
    const { runtime, notify } = runtimeTargetingIssue()

    await expect(
      editLinearComment(runtime, { input: 'ENG-1', commentId: COMMENT_ID, body: 'New' }, d)
    ).resolves.toEqual({
      comment: { id: COMMENT_ID, url: COMMENT_URL, parentId: null },
      issue,
      meta: { workspaceId: 'workspace-1', bodyChars: 3 }
    })
    expect(d.updateComment).toHaveBeenCalledWith(COMMENT_ID, 'New', 'workspace-1', {
      signal: expect.any(AbortSignal)
    })
    expect(notify).toHaveBeenCalledWith('workspace-1', 'ENG-1')
  })
})
