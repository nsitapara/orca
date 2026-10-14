import '../runtime/rpc/unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import { LINEAR_AGENT_ACCESS_METHODS } from '../runtime/rpc/methods/linear-agent-access'
import { dispatchRemoteLinearCommentEdit } from './ssh-remote-linear-comment-edit'
import { formatRemoteLinearCli } from './ssh-remote-linear-output'

const issue = { id: 'issue-1', identifier: 'ENG-1', url: 'https://linear.app/acme/issue/ENG-1' }

describe('SSH remote Linear comment edits', () => {
  it('reads the new body from stdin and targets the comment on the issue', async () => {
    const linearIssueEditComment = vi.fn().mockResolvedValue({ ok: true })
    const runtime = {
      getRuntimeId: () => 'runtime-test',
      linearIssueEditComment
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: LINEAR_AGENT_ACCESS_METHODS })

    const response = await dispatchRemoteLinearCommentEdit(
      dispatcher,
      {
        commandPath: ['linear', 'comment', 'edit'],
        flags: new Map<string, string | boolean>([
          ['id', 'ENG-1'],
          ['comment', 'comment-1'],
          ['body-file', '-']
        ])
      },
      {},
      'line one\nline two'
    )

    expect(response.ok).toBe(true)
    expect(linearIssueEditComment).toHaveBeenCalledWith({
      input: 'ENG-1',
      current: false,
      workspaceId: undefined,
      commentId: 'comment-1',
      body: 'line one\nline two',
      context: { remote: true }
    })
  })

  it.each([
    {
      name: 'an edit',
      meta: { workspaceId: 'workspace-1', bodyChars: 3 },
      stdout: 'Edited comment comment-1 on ENG-1.\n'
    },
    {
      name: 'an add',
      meta: { workspaceId: 'workspace-1', bodyChars: 3, writeId: 'write-1', deduplicated: false },
      stdout: 'Added comment comment-1 to ENG-1.\n'
    }
  ])('prints $name result as that verb', ({ meta, stdout }) => {
    const result = { comment: { id: 'comment-1', url: null, parentId: null }, issue, meta }

    expect(formatRemoteLinearCli(result)?.stdout).toBe(stdout)
  })
})
