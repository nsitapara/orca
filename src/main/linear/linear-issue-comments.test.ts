import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getClients: vi.fn() }))

vi.mock('./linear-request-concurrency', () => ({
  acquire: vi.fn().mockResolvedValue(undefined),
  release: vi.fn()
}))

vi.mock('./linear-token-store', () => ({ clearToken: vi.fn() }))

vi.mock('./client', () => ({
  getClients: mocks.getClients,
  getPublicFileUrlClient: vi.fn(),
  isAuthError: () => false
}))

import { updateIssueCommentForAgent } from './linear-issue-comments'

const COMMENT_ID = '11111111-1111-4111-8111-111111111111'

function connectWithReadback(comment: unknown): { updateComment: ReturnType<typeof vi.fn> } {
  const updateComment = vi.fn().mockResolvedValue({ success: true })
  const rawRequest = vi.fn().mockResolvedValue({ data: { comment } })
  mocks.getClients.mockReturnValue([
    { workspace: { id: 'workspace-1' }, client: { updateComment, client: { rawRequest } } }
  ])
  return { updateComment }
}

describe('updateIssueCommentForAgent', () => {
  it('sends the new body and returns the comment Linear reads back', async () => {
    const { updateComment } = connectWithReadback({
      id: COMMENT_ID,
      url: 'https://linear.app/acme/issue/ENG-1#comment-1',
      body: 'New',
      parent: null,
      issue: { id: 'issue-1', identifier: 'ENG-1', url: 'https://linear.app/acme/issue/ENG-1' }
    })

    await expect(updateIssueCommentForAgent(COMMENT_ID, 'New', 'workspace-1')).resolves.toEqual({
      id: COMMENT_ID,
      url: 'https://linear.app/acme/issue/ENG-1#comment-1',
      body: 'New',
      issue: { id: 'issue-1', identifier: 'ENG-1', url: 'https://linear.app/acme/issue/ENG-1' },
      parentId: null,
      threadRootId: COMMENT_ID
    })
    expect(updateComment).toHaveBeenCalledWith(COMMENT_ID, { body: 'New' })
  })

  it('treats a read-back miss after the update as unconfirmed', async () => {
    connectWithReadback(null)

    await expect(
      updateIssueCommentForAgent(COMMENT_ID, 'New', 'workspace-1')
    ).rejects.toMatchObject({ kind: 'unconfirmed' })
  })
})
