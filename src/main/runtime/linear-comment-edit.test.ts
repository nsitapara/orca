import { afterEach, describe, expect, it, vi } from 'vitest'
import { LINEAR_WRITE_BODY_CAP } from '../../shared/linear/agent-access'
import type * as RuntimeLinearCommandDependencies from './runtime-linear-command-dependencies'

const mocks = vi.hoisted(() => ({ getComment: vi.fn(), updateComment: vi.fn() }))

vi.mock('./runtime-linear-command-dependencies', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeLinearCommandDependencies>()),
  getLinearCommentByUuidForAgent: mocks.getComment,
  updateLinearIssueCommentForAgent: mocks.updateComment
}))

import { OrcaRuntimeService } from './orca-runtime'

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

function runtimeTargetingIssue(): {
  runtime: OrcaRuntimeService
  notify: ReturnType<typeof vi.fn>
} {
  const runtime = new OrcaRuntimeService()
  const notify = vi.fn().mockResolvedValue(undefined)
  Object.assign(runtime, {
    resolveLinearAgentWriteTarget: vi.fn().mockResolvedValue({ issue, workspaceId: 'workspace-1' }),
    notifyLinearLinkedIssueUpdated: notify
  })
  return { runtime, notify }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('Linear comment edit', () => {
  it.each([
    { name: 'a comment on another issue', commentId: COMMENT_ID, found: commentOn('issue-2') },
    { name: 'a comment Linear cannot find', commentId: COMMENT_ID, found: null },
    { name: 'a comment id that is not a UUID', commentId: 'comment-1', found: commentOn('issue-1') }
  ])('refuses $name without writing', async ({ commentId, found }) => {
    mocks.getComment.mockResolvedValue(found)
    const { runtime } = runtimeTargetingIssue()

    await expect(
      runtime.linearIssueEditComment({ input: 'ENG-1', commentId, body: 'New' })
    ).rejects.toMatchObject({ code: 'linear_invalid_comment' })
    expect(mocks.updateComment).not.toHaveBeenCalled()
  })

  it('refuses an oversized body before resolving the issue', async () => {
    const { runtime } = runtimeTargetingIssue()

    await expect(
      runtime.linearIssueEditComment({
        input: 'ENG-1',
        commentId: COMMENT_ID,
        body: 'x'.repeat(LINEAR_WRITE_BODY_CAP + 1)
      })
    ).rejects.toMatchObject({ code: 'linear_body_too_large' })
    expect(mocks.getComment).not.toHaveBeenCalled()
  })

  it('replaces the body of a comment on the issue', async () => {
    mocks.getComment.mockResolvedValue(commentOn('issue-1'))
    mocks.updateComment.mockResolvedValue(commentOn('issue-1', 'New'))
    const { runtime, notify } = runtimeTargetingIssue()

    await expect(
      runtime.linearIssueEditComment({ input: 'ENG-1', commentId: COMMENT_ID, body: 'New' })
    ).resolves.toEqual({
      comment: { id: COMMENT_ID, url: COMMENT_URL, parentId: null },
      issue,
      meta: { workspaceId: 'workspace-1', bodyChars: 3 }
    })
    expect(mocks.updateComment).toHaveBeenCalledWith(COMMENT_ID, 'New', 'workspace-1', {
      signal: expect.any(AbortSignal)
    })
    expect(notify).toHaveBeenCalledWith('workspace-1', 'ENG-1')
  })
})
