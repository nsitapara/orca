import { describe, expect, it, vi } from 'vitest'
import { fakePilotcli } from '../envs/__fixtures__/fake-pilotcli'
import { pilotcliRunner, type Pilotcli, type PilotcliReply } from '../envs/pilotcli'
import { RUN_TIMEOUT_MS } from './act-bridge'
import { checkReadyArgs, MARK_READY_USAGE, markReadyEntry, updateMrArgs } from './mark-ready'
import type { ActionCaller, ActionResult } from './types'

const SHA = '430f7e68'
const ARGS = { argv: ['1577', SHA] }
const PIN = { iid: '1577', sha: SHA }
const URL = 'https://gitlab.com/polygenx/web-platform/-/merge_requests/1577'
const USAGE = `usage: ${MARK_READY_USAGE}`
const CARD: ActionCaller = { runId: 'run-1', inboxItemId: 'in_0000000000000001' }

function reply(
  outcome: PilotcliReply['outcome'],
  reason: string,
  data: unknown = null
): PilotcliReply {
  return { outcome, reason, data, code: null }
}

const READY = reply('ok', '', { subject: '1577', conditions: [] })
const MARKED = reply('ok', '', { iid: 1577, draft: false, web_url: URL })

// The entry over an injected pilotcli that answers check-mr, then update-mr; no process runs.
function entryAnswering(
  answers: PilotcliReply[],
  over: { folder?: string | null; openCards?: string | null } = {}
) {
  const pilotcli = vi.fn<Pilotcli>()
  for (const answer of answers) {
    pilotcli.mockResolvedValueOnce(answer)
  }
  const folder = vi.fn((_caller: ActionCaller) => over.folder ?? null)
  const openCards = vi.fn((_iid: number, _caller: ActionCaller) => over.openCards ?? null)
  const entry = markReadyEntry({ pilotcli, binary: () => '/bin/pilotcli', folder, openCards })
  return { pilotcli, entry, folder, openCards }
}

const run = (entry: ReturnType<typeof markReadyEntry>, dryRun = false) =>
  entry.run(ARGS, { dryRun, runId: CARD.runId, inboxItemId: CARD.inboxItemId })

describe('the mark_ready action (pilotcli gitlab check-mr ready=true, then update-mr draft=false)', () => {
  it('checks the MR in the order the rules need, then marks it ready at the pinned head', async () => {
    const { pilotcli, entry } = entryAnswering([READY, MARKED])
    await run(entry)
    expect(pilotcli.mock.calls.map(([call]) => call.args)).toEqual([
      [
        'gitlab',
        'check-mr',
        '1577',
        'mine=true',
        'active=true',
        'author=me',
        `sha=${SHA}`,
        'ready=true',
        '--format=json'
      ],
      [
        'gitlab',
        'update-mr',
        '1577',
        'draft=false',
        `--expect-sha=${SHA}`,
        '--dry-run=false',
        '--format=json'
      ]
    ])
    expect(pilotcli.mock.calls.map(([call]) => call.timeoutMs)).toEqual([
      RUN_TIMEOUT_MS,
      RUN_TIMEOUT_MS
    ])
  })

  it("passes the card's worktree (-C) to both calls only when its folder is there", async () => {
    const { pilotcli, entry, folder } = entryAnswering([READY, MARKED], { folder: '/wt/web-1577' })
    await run(entry)
    expect(folder).toHaveBeenCalledWith(CARD)
    const [check, update] = pilotcli.mock.calls.map(([call]) => call.args)
    expect(check.slice(-2)).toEqual(['--dir=/wt/web-1577', '--format=json'])
    expect(update.slice(-3)).toEqual(['--dir=/wt/web-1577', '--dry-run=false', '--format=json'])
  })

  it('a dry run checks for real and asks update-mr for a dry run, so nothing is written', async () => {
    const { pilotcli, entry } = entryAnswering([
      READY,
      reply('ok', 'would mark !1577 ready for review', { iid: 1577, draft: true, web_url: URL })
    ])
    expect(await run(entry, true)).toMatchObject({
      outcome: 'done',
      detail: 'would mark !1577 ready for review',
      link: URL
    })
    const [check, update] = pilotcli.mock.calls.map(([call]) => call.args)
    expect(check.some((word) => word.startsWith('--dry-run'))).toBe(false)
    expect(update).toContain('--dry-run=true')
  })

  it("refuses while the MR's branch has open Pilot cards, before any pilotcli call", async () => {
    const { pilotcli, entry, openCards } = entryAnswering([READY, MARKED], {
      openCards: '2 open items from 03, 06'
    })
    expect(await run(entry)).toEqual({
      outcome: 'not_yet',
      detail: '2 open items from 03, 06',
      link: null,
      log: null,
      onYou: true
    })
    expect(openCards).toHaveBeenCalledWith(1577, CARD)
    expect(pilotcli).not.toHaveBeenCalled()
  })

  it.each<[string, PilotcliReply[], Partial<ActionResult>, number]>([
    [
      'a draft marked ready',
      [READY, MARKED],
      { outcome: 'done', detail: 'marked !1577 ready for review', link: URL, onYou: false },
      2
    ],
    [
      'an MR already ready (a second run)',
      [
        READY,
        reply('skip', '!1577 is already ready for review', {
          iid: 1577,
          draft: false,
          web_url: URL
        })
      ],
      { outcome: 'done', detail: '!1577 is already ready for review', link: URL },
      2
    ],
    [
      'a head that moved',
      [reply('skip', `sha: is 9b1c2d3e…, not ${SHA}`)],
      { outcome: 'stale', detail: `sha: is 9b1c2d3e…, not ${SHA}`, link: null },
      1
    ],
    [
      'a merged MR',
      [reply('skip', '!1577 merged')],
      { outcome: 'stale', detail: '!1577 merged' },
      1
    ],
    [
      'blockers',
      [reply('not_yet', '4 local commits not pushed yet; 1 open thread')],
      {
        outcome: 'not_yet',
        detail: '4 local commits not pushed yet; 1 open thread',
        link: null,
        onYou: true
      },
      1
    ],
    [
      'a check pilotcli refuses',
      [reply('invalid', 'no MR !1577 in polygenx/web-platform')],
      {
        outcome: 'failed',
        detail: 'pilotcli refused mark_ready: no MR !1577 in polygenx/web-platform'
      },
      1
    ],
    [
      'a check GitLab can’t answer',
      [reply('failed', 'MR owner unknown: GitLab didn’t name !1577’s author')],
      { outcome: 'failed', detail: 'MR owner unknown: GitLab didn’t name !1577’s author' },
      1
    ],
    [
      'an update the head moved under',
      [READY, reply('skip', 'stale: head is now 9b1c2d3')],
      { outcome: 'stale', detail: 'stale: head is now 9b1c2d3', link: null },
      2
    ],
    [
      'an update pilotcli refuses',
      [READY, reply('invalid', 'the one change update-mr makes is draft=false')],
      {
        outcome: 'failed',
        detail: 'pilotcli refused mark_ready: the one change update-mr makes is draft=false'
      },
      2
    ],
    [
      'an MR still a draft after the update',
      [READY, reply('failed', '!1577 is still a draft after the update')],
      { outcome: 'failed', detail: '!1577 is still a draft after the update' },
      2
    ]
  ])('maps %s', async (_name, answers, expected, calls) => {
    const { pilotcli, entry } = entryAnswering(answers)
    expect(await run(entry)).toMatchObject(expected)
    expect(pilotcli).toHaveBeenCalledTimes(calls)
  })

  // mark-ready.py's _parse: a whole-number iid and a 7-40 hex head; nothing else reaches a command line.
  it.each<[string, Record<string, unknown>]>([
    ['an iid that is not a number', { argv: ['nope', SHA] }],
    ['an iid that reads as a flag', { argv: ['--project=x', SHA] }],
    ['a head that is not a sha', { argv: ['1577', 'not-a-sha'] }],
    ['a head under 7 characters', { argv: ['1577', 'abc'] }],
    ['an upper-case head', { argv: ['1577', SHA.toUpperCase()] }],
    ['three values', { argv: ['1577', SHA, 'x'] }],
    ['a key besides argv', { ...ARGS, override: true }]
  ])('never runs pilotcli for %s', async (_name, args) => {
    const { pilotcli, entry } = entryAnswering([READY, MARKED])
    expect(entry.checkArgs(args)).toBe(USAGE)
    expect(entry.command!(args, CARD)).toBeNull()
    expect(await entry.run(args, { dryRun: false, runId: 'r' })).toMatchObject({
      outcome: 'failed',
      detail: USAGE
    })
    expect(pilotcli).not.toHaveBeenCalled()
  })

  it('takes a full 40-character head as stored cards may carry it', () => {
    const { entry } = entryAnswering([])
    expect(entry.checkArgs({ argv: ['1577', SHA.padEnd(40, 'a')] })).toBeNull()
  })

  it('needs the mark_ready power and says what it marks', async () => {
    const { entry } = entryAnswering([])
    expect([entry.name, entry.power]).toEqual(['mark_ready', 'mark_ready'])
    expect(await entry.describe(ARGS)).toBe('Mark !1577 ready for review on GitLab (head 430f7e68)')
    expect(entry.refresh).toBeUndefined()
  })

  it('runs what its Run line shows, through the real pilotcli client', async () => {
    const fake = fakePilotcli()
    fake.answer('gitlab-check-mr', {
      json: { v: 1, command: 'gitlab check-mr', outcome: 'ok', reason: '', data: READY.data }
    })
    fake.answer('gitlab-update-mr', {
      json: { v: 1, command: 'gitlab update-mr', outcome: 'ok', reason: '', data: MARKED.data }
    })
    const entry = markReadyEntry({
      pilotcli: pilotcliRunner({ pilotBinDir: '', binary: () => fake.bin, baseEnv: fake.env }),
      binary: () => fake.bin,
      folder: () => '/wt/web-1577',
      openCards: () => null
    })
    expect(await run(entry)).toMatchObject({
      outcome: 'done',
      detail: 'marked !1577 ready for review',
      link: URL
    })
    expect(fake.calls()).toEqual([
      checkReadyArgs(PIN, '/wt/web-1577').join(' '),
      updateMrArgs(PIN, '/wt/web-1577', false).join(' ')
    ])
    // The Run line is the write the approval makes; the check before it only reads.
    expect(entry.command!(ARGS, CARD)).toEqual([
      fake.bin,
      ...updateMrArgs(PIN, '/wt/web-1577', false)
    ])
  })
})
