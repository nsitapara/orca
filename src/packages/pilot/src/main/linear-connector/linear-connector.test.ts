import { describe, expect, it, vi } from 'vitest'
import type { LinearIssueListResult } from '../../../../../shared/linear/agent-access'
import type { LinearConnectionStatus } from '../../../../../shared/linear/workspace-types'
import { incompleteListing, runtimeLinearConnector, type LinearRuntime } from './linear-connector'

function fakeRuntime() {
  return {
    linearIssueListForAgents: vi.fn(async () => ({ issues: [], meta: {} })),
    linearIssueContext: vi.fn(async () => ({
      issue: { identifier: 'WEB-1', branchName: 'web-1-x' }
    })),
    linearIssueCreate: vi.fn(async () => ({})),
    linearIssueAddComment: vi.fn(async () => ({})),
    linearIssueSetState: vi.fn(async () => ({})),
    linearIssueAttachLink: vi.fn(async () => ({})),
    linearStatus: vi.fn(() => ({ connected: true, viewer: null }))
  }
}

const NO_INCLUDES = {
  comments: false,
  children: false,
  attachments: false,
  relations: false,
  activity: false
}

describe('runtimeLinearConnector sends what the orca linear CLI sends', () => {
  it.each([
    [
      'list --filter assigned --workspace all --limit 200',
      (c: ReturnType<typeof runtimeLinearConnector>) => c.listIssues('assigned'),
      'linearIssueListForAgents',
      { filter: 'assigned', workspaceId: 'all', limit: 200 }
    ],
    [
      'issue WEB-1 --workspace ws1',
      (c: ReturnType<typeof runtimeLinearConnector>) => c.issue('WEB-1', 'ws1'),
      'linearIssueContext',
      { input: 'WEB-1', current: false, workspaceId: 'ws1', include: NO_INCLUDES, depth: 2 }
    ],
    [
      'create --title … --team WEB --state "In Progress" --assignee me --priority high --label bug',
      (c: ReturnType<typeof runtimeLinearConnector>) =>
        c.create({
          title: 'Fix hourly e2e failure on dev: e2e',
          body: 'body',
          teamInput: 'WEB',
          state: 'In Progress',
          assignee: 'me',
          priority: 2,
          labels: ['bug'],
          writeId: '0b8e2d8e-6f3c-4f8e-9c4c-2b1f8d1e1f00'
        }),
      'linearIssueCreate',
      {
        title: 'Fix hourly e2e failure on dev: e2e',
        body: 'body',
        teamInput: 'WEB',
        state: 'In Progress',
        assignee: 'me',
        priority: 2,
        labels: ['bug'],
        writeId: '0b8e2d8e-6f3c-4f8e-9c4c-2b1f8d1e1f00'
      }
    ],
    [
      'comment add WEB-1 --body-file …',
      (c: ReturnType<typeof runtimeLinearConnector>) =>
        c.comment({ issue: 'WEB-1', body: '**Failed again (agent)**' }),
      'linearIssueAddComment',
      {
        input: 'WEB-1',
        body: '**Failed again (agent)**',
        workspaceId: undefined,
        writeId: undefined
      }
    ],
    [
      'status set WEB-1 --to Canceled',
      (c: ReturnType<typeof runtimeLinearConnector>) =>
        c.setState({ issue: 'WEB-1', to: 'Canceled' }),
      'linearIssueSetState',
      { input: 'WEB-1', to: 'Canceled', workspaceId: undefined }
    ],
    [
      'attach WEB-1 --url … --title "MR !1600"',
      (c: ReturnType<typeof runtimeLinearConnector>) =>
        c.attach({
          issue: 'WEB-1',
          url: 'https://gitlab.com/p/-/merge_requests/1600',
          title: 'MR !1600'
        }),
      'linearIssueAttachLink',
      {
        input: 'WEB-1',
        url: 'https://gitlab.com/p/-/merge_requests/1600',
        title: 'MR !1600',
        workspaceId: undefined,
        writeId: undefined
      }
    ]
  ] as const)('%s', async (_cli, call, method, request) => {
    const runtime = fakeRuntime()
    await call(runtimeLinearConnector(runtime as unknown as LinearRuntime))
    expect(runtime[method]).toHaveBeenCalledWith(request)
  })

  it('returns the issue from the issue context', async () => {
    const runtime = fakeRuntime()
    const issue = await runtimeLinearConnector(runtime as unknown as LinearRuntime).issue('WEB-1')
    expect(issue).toEqual({ identifier: 'WEB-1', branchName: 'web-1-x' })
  })
})

// The all-workspaces listing skips a workspace it can't sign in to, so an empty answer can mean "no Linear".
describe('listIssues tells "not connected" from "connected, no tickets"', () => {
  const connector = (status: LinearConnectionStatus) =>
    runtimeLinearConnector({
      ...fakeRuntime(),
      linearStatus: vi.fn(() => status)
    } as unknown as LinearRuntime)

  it('returns an empty listing when Linear is connected and has no tickets', async () => {
    await expect(
      connector({ connected: true, viewer: null }).listIssues('assigned')
    ).resolves.toEqual({
      issues: [],
      meta: {}
    })
  })

  it.each([
    [
      'no Linear workspace signed in',
      { connected: false, viewer: null },
      "Linear isn't connected in Pilot (no Linear workspace is signed in; connect Linear in Pilot's Settings)"
    ],
    [
      'a saved login it cannot read',
      {
        connected: true,
        viewer: null,
        credentialError:
          'Could not decrypt saved Linear credential. Approve Keychain access or reconnect Linear.'
      },
      "Linear isn't connected in Pilot (its saved Linear login can't be read: Could not decrypt saved Linear credential. Approve Keychain access or reconnect Linear.)"
    ]
  ])('refuses the listing with %s', async (_name, status, refusal) => {
    await expect(connector(status).listIssues('assigned')).rejects.toThrow(refusal)
  })
})

// linear-todo-sweep assigned_unstarted(): a listing that may be short is refused, never guessed at.
describe('incompleteListing', () => {
  const listing = (over: Partial<LinearIssueListResult['meta']> & { truncated?: boolean } = {}) => {
    const { truncated, ...meta } = over
    return {
      issues: [],
      truncated,
      meta: {
        filter: 'assigned',
        limit: 200,
        returned: 0,
        hasMore: false,
        partial: false,
        workspaceErrors: [],
        ...meta
      }
    } as LinearIssueListResult
  }
  it.each([
    ['complete', listing(), false],
    ['truncated', listing({ truncated: true }), true],
    ['has more', listing({ hasMore: true }), true],
    ['partial', listing({ partial: true }), true],
    [
      'a workspace failed',
      listing({
        workspaceErrors: [
          { workspace: { id: 'w', name: 'W' }, code: 'linear_timeout', message: 'slow' }
        ]
      }),
      true
    ]
  ] as [string, LinearIssueListResult, boolean][])('%s', (_name, result, refused) => {
    const why = incompleteListing(result)
    expect(why !== null).toBe(refused)
    if (why) {
      expect(why).toMatch(/^incomplete Linear listing, refusing to guess: \{/)
    }
  })
})
