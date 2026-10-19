import { describe, expect, it, vi } from 'vitest'
import { linearError } from '../../../../../main/linear/issue-context-errors'
import type { LinearConnector, LinearRuntime } from './linear-connector'
import { createLinearWriter, linearWriterOver } from './linear-writer'

function fakeLinear(over: Partial<Record<keyof LinearConnector, unknown>> = {}) {
  const linear = {
    listIssues: vi.fn(),
    issue: vi.fn(async (id: string) => ({ identifier: id, branchName: 'web-2118-fix-hourly-e2e' })),
    create: vi.fn(async () => ({
      issue: { identifier: 'WEB-2118', url: 'https://linear.app/x/issue/WEB-2118', title: 'T' },
      meta: { workspaceId: 'ws1', writeId: 'w', deduplicated: false }
    })),
    comment: vi.fn(async () => ({
      comment: { url: 'https://linear.app/x/c/1' },
      issue: { identifier: 'WEB-1' }
    })),
    setState: vi.fn(async () => ({ state: { name: 'Canceled' }, meta: { alreadyInState: false } })),
    attach: vi.fn(async () => ({
      attachment: { url: 'https://gitlab.com/mr/1' },
      issue: { identifier: 'WEB-1' }
    })),
    ...over
  }
  return linear as typeof linear & LinearConnector
}

const WRITE = '0b8e2d8e-6f3c-4f8e-9c4c-2b1f8d1e1f00'

describe('linearWriterOver sends what the orca linear CLI sends', () => {
  it("creates 13's ticket and reads its branch back", async () => {
    const linear = fakeLinear()
    const made = await linearWriterOver(linear).createIssue({
      team: 'WEB',
      title: 'Fix hourly e2e failure on dev: e2e-checks-and-build',
      body: '**Hourly e2e failed on dev**',
      state: 'In Progress',
      assignee: 'me',
      priority: 'high',
      labels: ['bug'],
      writeId: WRITE
    })
    expect(linear.create).toHaveBeenCalledWith({
      title: 'Fix hourly e2e failure on dev: e2e-checks-and-build',
      body: '**Hourly e2e failed on dev**',
      teamInput: 'WEB',
      state: 'In Progress',
      assignee: 'me',
      priority: 2,
      labels: ['bug'],
      workspaceId: undefined,
      writeId: WRITE
    })
    expect(linear.issue).toHaveBeenCalledWith('WEB-2118', 'ws1')
    expect(made).toEqual({
      identifier: 'WEB-2118',
      url: 'https://linear.app/x/issue/WEB-2118',
      branchName: 'web-2118-fix-hourly-e2e'
    })
  })

  it.each([
    [
      'addComment',
      (w: ReturnType<typeof linearWriterOver>) =>
        w.addComment('WEB-1', 'Failed again', { writeId: WRITE }),
      'comment',
      { issue: 'WEB-1', body: 'Failed again', workspaceId: undefined, writeId: WRITE },
      { url: 'https://linear.app/x/c/1' }
    ],
    [
      'setState',
      (w: ReturnType<typeof linearWriterOver>) =>
        w.setState('WEB-1', 'Canceled', { workspaceId: 'ws1' }),
      'setState',
      { issue: 'WEB-1', to: 'Canceled', workspaceId: 'ws1' },
      undefined
    ],
    [
      'attachUrl',
      (w: ReturnType<typeof linearWriterOver>) =>
        w.attachUrl('WEB-1', 'https://gitlab.com/mr/1', 'MR !1', { writeId: WRITE }),
      'attach',
      {
        issue: 'WEB-1',
        url: 'https://gitlab.com/mr/1',
        title: 'MR !1',
        workspaceId: undefined,
        writeId: WRITE
      },
      undefined
    ]
  ] as const)('%s', async (_name, call, method, request, result) => {
    const linear = fakeLinear()
    expect(await call(linearWriterOver(linear))).toEqual(result)
    expect(linear[method]).toHaveBeenCalledWith(request)
  })

  it('keeps the ticket when its branch cannot be read back, and refuses a priority it does not know', async () => {
    const linear = fakeLinear({
      issue: vi.fn(async () => {
        throw new Error('linear_timeout')
      })
    })
    const writer = linearWriterOver(linear)
    const made = await writer.createIssue({ team: 'WEB', title: 'T', body: '', writeId: WRITE })
    expect(made.branchName).toBeNull()
    await expect(
      writer.createIssue({ team: 'WEB', title: 'T', body: '', priority: 'highest', writeId: WRITE })
    ).rejects.toThrow('unknown priority "highest"')
  })

  it.each([
    [
      'createIssue',
      (w: ReturnType<typeof linearWriterOver>, id: string) =>
        w.createIssue({ team: 'WEB', title: 'T', body: '', writeId: id })
    ],
    [
      'addComment',
      (w: ReturnType<typeof linearWriterOver>, id: string) =>
        w.addComment('WEB-1', 'b', { writeId: id })
    ],
    [
      'attachUrl',
      (w: ReturnType<typeof linearWriterOver>, id: string) =>
        w.attachUrl('WEB-1', 'https://x.y', 't', { writeId: id })
    ]
  ])('%s refuses a missing writeId and sends nothing', async (_name, call) => {
    const linear = fakeLinear()
    await expect(call(linearWriterOver(linear), '')).rejects.toThrow('needs a writeId')
    await expect(call(linearWriterOver(linear), undefined as unknown as string)).rejects.toThrow(
      'needs a writeId'
    )
    expect(linear.create).not.toHaveBeenCalled()
    expect(linear.comment).not.toHaveBeenCalled()
    expect(linear.attach).not.toHaveBeenCalled()
  })
})

describe("createLinearWriter's screenshot uploads", () => {
  const IMAGE = {
    bytes: new Uint8Array([1]),
    contentType: 'image/png',
    filename: 'a.png',
    workspaceId: 'ws2'
  }
  const ASSET = { assetUrl: 'https://uploads.linear.app/a/1' }

  function writerResolving(resolve: () => Promise<unknown>) {
    const resolveTeam = vi.fn().mockImplementation(resolve)
    const runtime: LinearRuntime = {
      linearIssueListForAgents: vi.fn(),
      linearIssueContext: vi.fn(),
      linearIssueCreate: vi.fn(),
      linearIssueAddComment: vi.fn(),
      linearIssueSetState: vi.fn(),
      linearIssueAttachLink: vi.fn(),
      linearStatus: vi.fn(),
      resolveLinearCreateTeam: resolveTeam
    }
    const upload = vi.fn().mockResolvedValue(ASSET)
    return { writer: createLinearWriter(runtime, upload), upload, resolveTeam }
  }
  const resolvesToWs2 = async () => ({ id: 't2', key: 'WEB', name: 'Web', workspaceId: 'ws2' })

  it.each([
    [
      'resolves the workspace that owns the team, as orca linear create does',
      undefined,
      'ws2',
      [['WEB', undefined, null]]
    ],
    ['takes the workspace the args name', 'ws9', 'ws9', []]
  ])('%s', async (_name, workspaceId, found, resolutions) => {
    const { writer, resolveTeam } = writerResolving(resolvesToWs2)

    await expect(writer.teamWorkspace('WEB', workspaceId)).resolves.toBe(found)
    expect(resolveTeam.mock.calls).toEqual(resolutions)
  })

  it('refuses a team that is in several workspaces', async () => {
    const { writer } = writerResolving(async () => {
      throw linearError('linear_workspace_ambiguous', 'Team WEB exists in multiple workspaces.')
    })

    await expect(writer.teamWorkspace('WEB')).rejects.toMatchObject({
      code: 'linear_workspace_ambiguous'
    })
  })

  it('uploads into the workspace it is given, without resolving a team', async () => {
    const { writer, upload, resolveTeam } = writerResolving(resolvesToWs2)

    await expect(writer.uploadImage(IMAGE)).resolves.toEqual(ASSET)
    expect(upload).toHaveBeenCalledWith(IMAGE)
    expect(resolveTeam).not.toHaveBeenCalled()
  })
})
