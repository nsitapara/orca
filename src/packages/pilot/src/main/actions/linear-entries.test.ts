import { z } from 'zod'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { LinearWriter } from '../linear-connector/linear-writer'
import { LINEAR_NOT_CONNECTED, linearEntries, writeIdFor } from './linear-entries'

function writer(): { [K in keyof LinearWriter]: Mock<LinearWriter[K]> } {
  return {
    createIssue: vi.fn().mockResolvedValue({
      identifier: 'WEB-2118',
      url: 'https://linear.app/x/WEB-2118',
      branchName: 'web-2118-fix'
    }),
    addComment: vi.fn().mockResolvedValue({ url: 'https://linear.app/x/WEB-2118#c' }),
    setState: vi.fn().mockResolvedValue(undefined),
    attachUrl: vi.fn().mockResolvedValue(undefined)
  }
}
const entry = (linear: LinearWriter | null, name: string) =>
  linearEntries(linear).find((e) => e.name === name)!
const RUN = { dryRun: false, runId: 'e2e-1' }
const WRITE = '5b1c8a0e-6a38-4f55-9a0e-2f5f3e9d7a11'

describe('Linear entries', () => {
  it.each([
    ['linear_create', 'create_ticket'],
    ['linear_comment', 'update_ticket'],
    ['linear_set_state', 'update_ticket'],
    ['linear_attach', 'update_ticket']
  ])('%s needs the %s power', (name, power) => expect(entry(writer(), name).power).toBe(power))

  it('creates a ticket from its args object, and returns its id, branch and url', async () => {
    const w = writer()
    const args = {
      team: 'WEB',
      title: 'Fix hourly e2e failure on dev: a',
      body: '**🔴 Hourly e2e failed on dev**',
      state: 'In Progress',
      assignee: 'me',
      priority: 'high',
      labels: ['bug'],
      write_id: WRITE
    }
    const result = await entry(w, 'linear_create').run(args, RUN)
    expect(w.createIssue).toHaveBeenCalledWith({
      team: 'WEB',
      title: 'Fix hourly e2e failure on dev: a',
      body: '**🔴 Hourly e2e failed on dev**',
      state: 'In Progress',
      assignee: 'me',
      priority: 'high',
      labels: ['bug'],
      workspaceId: undefined,
      writeId: WRITE
    })
    expect(result).toEqual({
      outcome: 'done',
      detail: 'created WEB-2118',
      link: 'https://linear.app/x/WEB-2118',
      log: null,
      onYou: false,
      data: {
        identifier: 'WEB-2118',
        branchName: 'web-2118-fix',
        url: 'https://linear.app/x/WEB-2118'
      }
    })
  })

  it('names a numeric priority before calling the writer', async () => {
    const w = writer()
    await entry(w, 'linear_create').run(
      { team: 'WEB', title: 't', priority: 2, write_id: WRITE },
      RUN
    )
    expect(w.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'high', body: '' })
    )
  })

  it.each([
    [
      'linear_comment',
      { issue: 'WEB-2118', body: 'Failed again', write_id: WRITE },
      'addComment',
      ['WEB-2118', 'Failed again', { workspaceId: undefined, writeId: WRITE }],
      'commented on WEB-2118'
    ],
    [
      'linear_set_state',
      { issue: 'WEB-2118', to: 'Canceled' },
      'setState',
      ['WEB-2118', 'Canceled', { workspaceId: undefined }],
      'WEB-2118 → Canceled'
    ],
    [
      'linear_attach',
      { issue: 'WEB-2118', url: 'https://gitlab.com/mr/1', title: 'MR !1', write_id: WRITE },
      'attachUrl',
      ['WEB-2118', 'https://gitlab.com/mr/1', 'MR !1', { workspaceId: undefined, writeId: WRITE }],
      'attached MR !1 to WEB-2118'
    ]
  ])('%s calls the writer', async (name, args, method, called, detail) => {
    const w = writer()
    const result = await entry(w, name).run(args, RUN)
    expect(w[method as keyof LinearWriter]).toHaveBeenCalledWith(...called)
    expect(result).toMatchObject({ outcome: 'done', detail })
  })

  it('pins a write id derived from the attempt key, once, and only on the entries Linear can deduplicate', () => {
    const create = entry(writer(), 'linear_create')
    const pinned = create.pin!({ team: 'WEB', title: 'T' }, 'run-1|0|linear_create|a')
    expect(pinned.write_id).toBe(writeIdFor('run-1|0|linear_create|a'))
    expect(create.pin!({ team: 'WEB', title: 'T' }, 'run-1|0|linear_create|a')).toEqual(pinned)
    expect(create.pin!(pinned, 'another key')).toEqual(pinned)
    expect(entry(writer(), 'linear_set_state').pin).toBeUndefined()
  })

  it('derives write ids Linear takes: the same key gives the same v4-shaped uuid', () => {
    const id = writeIdFor('run-1|0|linear_comment|x')
    expect(z.uuid().safeParse(id).success).toBe(true)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(writeIdFor('run-1|0|linear_comment|x')).toBe(id)
    expect(writeIdFor('run-2|0|linear_comment|x')).not.toBe(id)
  })

  it('never writes without a pinned write id (no random one is made up)', async () => {
    const w = writer()
    expect(await entry(w, 'linear_comment').run({ issue: 'WEB-1', body: 'b' }, RUN)).toMatchObject({
      outcome: 'failed',
      detail: expect.stringContaining('needs a write_id')
    })
    expect(w.addComment).not.toHaveBeenCalled()
  })

  it('changes nothing on a dry run', async () => {
    const w = writer()
    expect(
      await entry(w, 'linear_set_state').run(
        { issue: 'WEB-1', to: 'Done' },
        { ...RUN, dryRun: true }
      )
    ).toMatchObject({ outcome: 'done', detail: 'would move WEB-1 to Done' })
    expect(w.setState).not.toHaveBeenCalled()
  })

  it.each([
    ['bad arguments', writer(), { team: 'WEB' }, 'usage: linear_create'],
    ['unknown arguments', writer(), { team: 'WEB', title: 't', extra: 1 }, 'usage: linear_create'],
    ['no Linear login', null, { team: 'WEB', title: 't' }, LINEAR_NOT_CONNECTED]
  ])('fails on %s', async (_name, w, args, detail) => {
    expect(await entry(w, 'linear_create').run(args, RUN)).toMatchObject({
      outcome: 'failed',
      detail: expect.stringContaining(detail)
    })
  })

  it('takes args that fit the schema', () => {
    expect(entry(writer(), 'linear_create').checkArgs({ team: 'WEB', title: 't' })).toBeNull()
  })

  it.each([
    ['linear_create', { team: 'WEB' }],
    ['linear_attach', { issue: 'WEB-1', url: 'javascript:x' }],
    ['linear_comment', { issue: 'WEB-1', body: 'b', write_id: 'not-a-uuid' }]
  ])('says why %s args %j miss its schema', (name, args) => {
    expect(entry(writer(), name).checkArgs(args)).toMatch(new RegExp(`^usage: ${name} `))
  })

  it("refuses a write_id that isn't a v4 uuid before Linear sees it", async () => {
    // Linear takes only a v4 uuid as a new entity's id; a v5 one came back as "id must be a UUID".
    const w = writer()
    const v5 = '296a9b53-05fb-55b0-aefa-00823f3f47e0'
    expect(
      await entry(w, 'linear_create').run({ team: 'WEB', title: 't', write_id: v5 }, RUN)
    ).toMatchObject({
      outcome: 'failed',
      detail: expect.stringContaining('write_id: must be a v4 uuid')
    })
    expect(w.createIssue).not.toHaveBeenCalled()
  })

  it("fails with Linear's message when the write fails", async () => {
    const w = writer()
    w.setState.mockRejectedValue(new Error('linear_invalid_state'))
    expect(
      await entry(w, 'linear_set_state').run({ issue: 'WEB-1', to: 'Nope' }, RUN)
    ).toMatchObject({ outcome: 'failed', detail: 'linear_invalid_state' })
  })
})
