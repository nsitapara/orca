import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeCommandPositionals, parseArgs } from '../../../../cli/args'
import type { HandlerContext } from '../../../../cli/dispatch'
import { LINEAR_HANDLERS } from './handlers-linear'
import { PILOT_COMMAND_SPECS } from './specs'

const EDITED = {
  comment: { id: 'comment-id', url: null, parentId: null },
  issue: { id: 'issue-id', identifier: 'ENG-123', url: 'https://linear.app/acme/issue/ENG-123' },
  meta: { workspaceId: 'workspace-1', bodyChars: 7 }
}

// The real parse, as the CLI reads `orca linear comment edit …`.
function contextFor(argv: string[]) {
  const parsed = normalizeCommandPositionals(
    PILOT_COMMAND_SPECS,
    parseArgs(argv, undefined, PILOT_COMMAND_SPECS)
  )
  const call = vi.fn().mockResolvedValue({ result: EDITED })
  const context = {
    flags: parsed.flags,
    client: { call, isRemote: false },
    cwd: '/tmp/repo',
    json: false
  } as unknown as HandlerContext
  return { context, call, commandPath: parsed.commandPath }
}

// The context names the caller's worktree and terminal when it runs in one; this test's runs in none.
beforeEach(() => {
  vi.stubEnv('ORCA_WORKTREE_ID', '')
  vi.stubEnv('ORCA_TERMINAL_HANDLE', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('linear comment edit', () => {
  it('sends the edit to Pilot and reports the edited comment', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { context, call, commandPath } = contextFor([
      'linear',
      'comment',
      'edit',
      'ENG-123',
      '--comment',
      'comment-id',
      '--body',
      'Updated'
    ])
    expect(commandPath).toEqual(['linear', 'comment', 'edit'])

    await LINEAR_HANDLERS['linear comment edit'](context)

    expect(call).toHaveBeenCalledWith(
      'pilot.linear.commentEdit',
      {
        input: 'ENG-123',
        current: false,
        workspaceId: undefined,
        commentId: 'comment-id',
        body: 'Updated',
        context: { remote: false, cwd: '/tmp/repo' }
      },
      { timeoutMs: 75_000 }
    )
    expect(log.mock.calls[0][0]).toBe('Edited comment comment-id on ENG-123.')
  })

  it('refuses without a comment id, before calling Pilot', async () => {
    const { context, call } = contextFor(['linear', 'comment', 'edit', 'ENG-123', '--body', 'x'])

    await expect(LINEAR_HANDLERS['linear comment edit'](context)).rejects.toThrow('comment')
    expect(call).not.toHaveBeenCalled()
  })
})
