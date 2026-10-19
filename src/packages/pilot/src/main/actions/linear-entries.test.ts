import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { afterAll, beforeAll, describe, expect, it, vi, type Mock } from 'vitest'
import { linearError } from '../../../../../main/linear/issue-context-errors'
import type { LinearWriter } from '../linear-connector/linear-writer'
import { LINEAR_NOT_CONNECTED, linearEntries, writeIdFor } from './linear-entries'

function writer(): { [K in keyof LinearWriter]: Mock<LinearWriter[K]> } {
  let uploads = 0
  return {
    uploadImage: vi.fn<LinearWriter['uploadImage']>(async () => ({
      assetUrl: `https://uploads.linear.app/a/${++uploads}`
    })),
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

describe('linear_create with screenshots and links', () => {
  let root = ''
  let outside = ''
  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'pilot-details-')))
    outside = realpathSync(mkdtempSync(join(tmpdir(), 'pilot-outside-')))
  })
  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  const shot = (name: string, text: string, dir = root) => {
    const path = join(dir, name)
    writeFileSync(path, text)
    return { path, sha256: createHash('sha256').update(text).digest('hex') }
  }
  const image = (n: number, file: { path: string; sha256: string }) => ({
    ref: `pilot-image:${n}`,
    ...file
  })
  const create = (w: LinearWriter | null, detailsRoot: string | null = root) =>
    linearEntries(w, { detailsRoot }).find((e) => e.name === 'linear_create')!
  const BASE = { team: 'WEB', title: 'Finding', write_id: WRITE }
  const NOWHERE = { path: '/nowhere/a.png', sha256: 'a'.repeat(64) }

  it('uploads each screenshot in order, then creates the ticket with their asset URLs in its body', async () => {
    const w = writer()
    const a = shot('a.png', 'one')
    const b = shot('b.png', 'two')
    const result = await create(w).run(
      {
        ...BASE,
        body: 'Before ![a](pilot-image:1)\nAfter ![b](pilot-image:2)',
        images: [{ ...image(2, b), caption: 'b' }, image(1, a)]
      },
      RUN
    )
    expect(
      w.uploadImage.mock.calls.map(([input]) => [
        Buffer.from(input.bytes).toString(),
        input.contentType,
        input.filename,
        input.team
      ])
    ).toEqual([
      ['two', 'image/png', 'b.png', 'WEB'],
      ['one', 'image/png', 'a.png', 'WEB']
    ])
    expect(w.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Before ![a](https://uploads.linear.app/a/2)\nAfter ![b](https://uploads.linear.app/a/1)'
      })
    )
    expect(Math.max(...w.uploadImage.mock.invocationCallOrder)).toBeLessThan(
      w.createIssue.mock.invocationCallOrder[0]
    )
    expect(result).toMatchObject({ outcome: 'done', detail: 'created WEB-2118' })
  })

  it('is stale when a screenshot changed since the draft, and posts nothing', async () => {
    const w = writer()
    const kept = shot('kept.png', 'one')
    const changed = shot('changed.png', 'two')
    writeFileSync(changed.path, 'edited')
    const result = await create(w).run(
      { ...BASE, images: [image(1, kept), image(2, changed)] },
      RUN
    )
    expect(result).toMatchObject({ outcome: 'stale', data: { created: 'no' } })
    expect(w.uploadImage).not.toHaveBeenCalled()
    expect(w.createIssue).not.toHaveBeenCalled()
  })

  it.each([
    ['a file outside the Automations folder', () => image(1, shot('x.png', 'one', outside)), true],
    [
      'a symlink out of the Automations folder',
      () => {
        const target = shot('y.png', 'one', outside)
        const link = join(root, 'link.png')
        symlinkSync(target.path, link)
        return image(1, { path: link, sha256: target.sha256 })
      },
      true
    ],
    ['no Automations folder', () => image(1, shot('z.png', 'one')), false]
  ])('fails on %s before any upload', async (_name, make, hasRoot) => {
    const w = writer()
    const result = await create(w, hasRoot ? root : null).run(
      { ...BASE, body: '![s](pilot-image:1)', images: [make()] },
      RUN
    )
    expect(result).toMatchObject({ outcome: 'failed', data: { created: 'no' } })
    expect(w.uploadImage).not.toHaveBeenCalled()
    expect(w.createIssue).not.toHaveBeenCalled()
  })

  it.each([
    [
      'a body ref with no image',
      { body: '![s](pilot-image:3)', images: [image(1, NOWHERE)] },
      'body: pilot-image:3'
    ],
    [
      'a ref given twice',
      { body: '![s](pilot-image:1)', images: [image(1, NOWHERE), image(1, NOWHERE)] },
      'images: pilot-image:1'
    ],
    [
      'a relative image path',
      { images: [{ ...image(1, NOWHERE), path: 'a.png' }] },
      'images.0.path'
    ],
    ['a link that is not http(s)', { links: [{ url: 'javascript:x' }] }, 'links.0.url']
  ])('checkArgs refuses %s', (_name, args, why) => {
    const problem = create(writer()).checkArgs({ ...BASE, ...args })
    expect(problem).toMatch(/^usage: linear_create /)
    expect(problem).toContain(why)
  })

  it("attaches each link after the create, with a write id per link derived from the create's", async () => {
    const links = [
      { url: 'https://gitlab.com/g/p/-/merge_requests/7', title: 'MR !7' },
      { url: 'https://gitlab.com/g/p/-/pipelines/9' }
    ]
    const attachIds = async (writeId: string) => {
      const w = writer()
      await create(w).run({ ...BASE, write_id: writeId, links }, RUN)
      return w
    }
    const w = await attachIds(WRITE)
    expect(w.attachUrl.mock.calls).toEqual([
      ['WEB-2118', links[0].url, 'MR !7', { workspaceId: undefined, writeId: expect.any(String) }],
      [
        'WEB-2118',
        links[1].url,
        links[1].url,
        { workspaceId: undefined, writeId: expect.any(String) }
      ]
    ])
    expect(w.createIssue.mock.invocationCallOrder[0]).toBeLessThan(
      w.attachUrl.mock.invocationCallOrder[0]
    )
    const ids = w.attachUrl.mock.calls.map((call) => call[3].writeId)
    expect(new Set([...ids, WRITE]).size).toBe(3)
    expect(ids.every((id) => z.uuidv4().safeParse(id).success)).toBe(true)
    const again = await attachIds(WRITE)
    expect(again.attachUrl.mock.calls.map((call) => call[3].writeId)).toEqual(ids)
    const other = await attachIds('7c9e6679-7425-40de-944b-e07fc1f90ae7')
    expect(other.attachUrl.mock.calls.map((call) => call[3].writeId)).not.toContain(ids[0])
  })

  it('is still done when a link fails to attach, and says why', async () => {
    const w = writer()
    w.attachUrl.mockRejectedValue(new Error('Attachment URL must be an absolute http(s) URL.'))
    expect(
      await create(w).run({ ...BASE, links: [{ url: 'https://gitlab.com/mr/1' }] }, RUN)
    ).toMatchObject({
      outcome: 'done',
      detail:
        'created WEB-2118 (MR link not attached: Attachment URL must be an absolute http(s) URL.)',
      link: 'https://linear.app/x/WEB-2118'
    })
  })

  it('fails before creating when a screenshot upload fails, and says nothing was created', async () => {
    const w = writer()
    w.uploadImage.mockRejectedValue(new Error('Linear refused the upload of up.png: HTTP 403'))
    const result = await create(w).run(
      { ...BASE, body: '![a](pilot-image:1)', images: [image(1, shot('up.png', 'one'))] },
      RUN
    )
    expect(result).toMatchObject({
      outcome: 'failed',
      detail: expect.stringContaining('Linear refused the upload of up.png: HTTP 403'),
      data: { created: 'no' }
    })
    expect(w.createIssue).not.toHaveBeenCalled()
  })

  // The codes `linearIssueCreate` raises (runtime-linear-create-commands.ts and what it calls).
  it.each([
    ['linear_write_unconfirmed', 'maybe'],
    ['linear_timeout', 'maybe'],
    ['linear_network_error', 'maybe'],
    ['linear_invalid_write_id', 'maybe'],
    [null, 'maybe'],
    ['linear_invalid_label', 'no'],
    ['linear_invalid_state', 'no'],
    ['linear_invalid_assignee', 'no'],
    ['linear_team_required', 'no'],
    ['linear_workspace_ambiguous', 'no'],
    ['linear_invalid_workspace', 'no'],
    ['linear_not_connected', 'no'],
    ['linear_body_too_large', 'no'],
    ['linear_write_failed', 'no'],
    ['linear_auth_expired', 'no'],
    ['linear_rate_limited', 'no'],
    ['linear_permission_denied', 'no']
  ] as const)('a create failing with code %s says created: %s', async (code, created) => {
    const w = writer()
    w.createIssue.mockRejectedValue(
      code === null ? new Error('socket hang up') : linearError(code, 'Linear said no')
    )
    expect(await create(w).run(BASE, RUN)).toMatchObject({ outcome: 'failed', data: { created } })
  })

  it.each([
    ['bad arguments', writer(), { team: 'WEB' }],
    ['no Linear login', null, BASE],
    ['no write id', writer(), { team: 'WEB', title: 't' }]
  ])('says nothing was created when it refuses on %s', async (_name, w, args) => {
    expect(await create(w).run(args, RUN)).toMatchObject({
      outcome: 'failed',
      data: { created: 'no' }
    })
  })

  it('names its screenshots and links in its description and dry run', async () => {
    const e = create(writer())
    const args = {
      ...BASE,
      body: '![a](pilot-image:1) ![b](pilot-image:2)',
      images: [image(1, NOWHERE), image(2, NOWHERE)],
      links: [{ url: 'https://gitlab.com/mr/1' }]
    }
    expect(await e.describe(args)).toBe('Create a WEB ticket: Finding (2 screenshots, 1 link)')
    expect(await e.run(args, { ...RUN, dryRun: true })).toMatchObject({
      outcome: 'done',
      detail: 'would create a WEB ticket: Finding (2 screenshots, 1 link)'
    })
  })
})
