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
const MAIN = '/repos/web-platform'
const BRANCH = 'web-1577'
const GET_MR = reply('ok', '', { iid: 1577, source_branch: BRANCH, web_url: URL })

type Over = {
  folder?: string | null
  branch?: string | null
  worktree?: string | null
  openCards?: string | null
}

// The entry over an injected pilotcli that answers in turn; no process runs. By default Pilot's store knows the MR's
// branch, no worktree is on it, nothing is open there, and the card's folder is the repo's main checkout.
function entryAnswering(answers: PilotcliReply[], over: Over = {}) {
  const pilotcli = vi.fn<Pilotcli>()
  for (const answer of answers) {
    pilotcli.mockResolvedValueOnce(answer)
  }
  const at = (key: keyof Over, fallback: string | null) =>
    over[key] === undefined ? fallback : (over[key] ?? null)
  const folder = vi.fn((_caller: ActionCaller) => at('folder', MAIN))
  const cards = {
    branchOf: vi.fn((_iid: number, _caller: ActionCaller) => at('branch', BRANCH)),
    worktreeOn: vi.fn((_branch: string) => at('worktree', null)),
    openOn: vi.fn((_iid: number, _branch: string, _caller: ActionCaller) => at('openCards', null))
  }
  const entry = markReadyEntry({ pilotcli, binary: () => '/bin/pilotcli', folder, cards })
  return { pilotcli, entry, folder, cards, args: () => pilotcli.mock.calls.map(([c]) => c.args) }
}

const run = (entry: ReturnType<typeof markReadyEntry>, dryRun = false) =>
  entry.run(ARGS, { dryRun, runId: CARD.runId, inboxItemId: CARD.inboxItemId })

describe('the mark_ready action (pilotcli gitlab check-mr ready=true, then update-mr draft=false)', () => {
  it('checks the MR in the order the rules need, then marks it ready at the pinned head', async () => {
    const { pilotcli, entry, folder, args } = entryAnswering([READY, MARKED])
    await run(entry)
    expect(folder).toHaveBeenCalledWith(CARD)
    expect(args()).toEqual([
      [
        'gitlab',
        'check-mr',
        '1577',
        'mine=true',
        'active=true',
        'author=me',
        `sha=${SHA}`,
        'ready=true',
        `--dir=${MAIN}`,
        '--format=json'
      ],
      [
        'gitlab',
        'update-mr',
        '1577',
        'draft=false',
        `--expect-sha=${SHA}`,
        `--dir=${MAIN}`,
        '--dry-run=false',
        '--format=json'
      ]
    ])
    expect(pilotcli.mock.calls.map(([call]) => call.timeoutMs)).toEqual([
      RUN_TIMEOUT_MS,
      RUN_TIMEOUT_MS
    ])
  })

  // mark-ready.py's _unpushed found the worktree by the MR's source branch.
  it("checks from the worktree on the MR's branch when there is one, so its unpushed commits count", async () => {
    const { entry, cards, args } = entryAnswering([READY, MARKED], { worktree: '/wt/web-1577' })
    await run(entry)
    expect(cards.worktreeOn).toHaveBeenCalledWith(BRANCH)
    const [check, update] = args()
    expect(check.slice(-2)).toEqual(['--dir=/wt/web-1577', '--format=json'])
    expect(update.slice(-3)).toEqual(['--dir=/wt/web-1577', '--dry-run=false', '--format=json'])
  })

  it('a dry run checks for real and asks update-mr for a dry run, so nothing is written', async () => {
    const { entry, args } = entryAnswering([
      READY,
      reply('ok', 'would mark !1577 ready for review', { iid: 1577, draft: true, web_url: URL })
    ])
    expect(await run(entry, true)).toMatchObject({
      outcome: 'done',
      detail: 'would mark !1577 ready for review',
      link: URL
    })
    const [check, update] = args()
    expect(check.some((word) => word.startsWith('--dry-run'))).toBe(false)
    expect(update).toContain('--dry-run=true')
  })

  it("refuses while the MR's branch has open Pilot cards, before any pilotcli call", async () => {
    const { pilotcli, entry, cards } = entryAnswering([READY, MARKED], {
      openCards: '2 open items from 03, 06'
    })
    expect(await run(entry)).toEqual({
      outcome: 'not_yet',
      detail: '2 open items from 03, 06',
      link: null,
      log: null,
      onYou: true
    })
    expect(cards.branchOf).toHaveBeenCalledWith(1577, CARD)
    expect(cards.openOn).toHaveBeenCalledWith(1577, BRANCH, CARD)
    expect(pilotcli).not.toHaveBeenCalled()
  })

  it("asks pilotcli get-mr for the branch Pilot's store doesn't know, then checks its cards", async () => {
    const { entry, cards, args } = entryAnswering([GET_MR, READY, MARKED], { branch: null })
    expect(await run(entry)).toMatchObject({ outcome: 'done' })
    expect(args()[0]).toEqual(['gitlab', 'get-mr', '1577', `--dir=${MAIN}`, '--format=json'])
    expect(args().map((a) => a[1])).toEqual(['get-mr', 'check-mr', 'update-mr'])
    expect(cards.openOn).toHaveBeenCalledWith(1577, BRANCH, CARD)
  })

  it('refuses on the cards of a branch get-mr named, with no check-mr or update-mr', async () => {
    const { entry, args } = entryAnswering([GET_MR, READY, MARKED], {
      branch: null,
      openCards: '1 open item from 03'
    })
    expect(await run(entry)).toMatchObject({ outcome: 'not_yet', detail: '1 open item from 03' })
    expect(args().map((a) => a[1])).toEqual(['get-mr'])
  })

  it.each<[string, PilotcliReply]>([
    ['no such MR', reply('skip', 'no MR !1577')],
    ['GitLab out of reach', reply('failed', 'gitlab.com unreachable')],
    ['an MR with no branch', reply('ok', '', { iid: 1577 })]
  ])(
    'fails closed when no branch can be learned (%s): it waits, and nothing is checked or written',
    async (_name, answer) => {
      const { entry, cards, args } = entryAnswering([answer, READY, MARKED], { branch: null })
      const result = await run(entry)
      expect(result).toMatchObject({ outcome: 'not_yet', onYou: true })
      expect(result.detail).toMatch(/^can't tell which cards are on !1577's branch/)
      expect(args().map((a) => a[1])).toEqual(['get-mr'])
      expect(cards.openOn).not.toHaveBeenCalled()
    }
  )

  it('fails before any call when no folder names the project', async () => {
    for (const branch of [BRANCH, null]) {
      const { pilotcli, entry } = entryAnswering([READY, MARKED], { folder: null, branch })
      expect(await run(entry)).toMatchObject({
        outcome: 'failed',
        detail: expect.stringContaining('no folder to run pilotcli in for !1577')
      })
      expect(pilotcli).not.toHaveBeenCalled()
    }
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
    fake.answer('gitlab-get-mr', {
      json: { v: 1, command: 'gitlab get-mr', outcome: 'ok', reason: '', data: GET_MR.data }
    })
    fake.answer('gitlab-check-mr', {
      json: { v: 1, command: 'gitlab check-mr', outcome: 'ok', reason: '', data: READY.data }
    })
    fake.answer('gitlab-update-mr', {
      json: { v: 1, command: 'gitlab update-mr', outcome: 'ok', reason: '', data: MARKED.data }
    })
    let known: string | null = null
    const entry = markReadyEntry({
      pilotcli: pilotcliRunner({ pilotBinDir: '', binary: () => fake.bin, baseEnv: fake.env }),
      binary: () => fake.bin,
      folder: () => MAIN,
      cards: {
        branchOf: () => known,
        worktreeOn: (branch) => (branch === BRANCH ? '/wt/web-1577' : null),
        openOn: () => null
      }
    })
    expect(await run(entry)).toMatchObject({
      outcome: 'done',
      detail: 'marked !1577 ready for review',
      link: URL
    })
    expect(fake.calls()).toEqual([
      `gitlab get-mr 1577 --dir=${MAIN} --format=json`,
      checkReadyArgs(PIN, '/wt/web-1577').join(' '),
      updateMrArgs(PIN, '/wt/web-1577', false).join(' ')
    ])
    // The Run line is the write the approval makes, from the worktree on the branch Pilot's store knows (the check
    // before it only reads); with no branch known yet, from the card's folder.
    expect(entry.command!(ARGS, CARD)).toEqual([fake.bin, ...updateMrArgs(PIN, MAIN, false)])
    known = BRANCH
    expect(entry.command!(ARGS, CARD)).toEqual([
      fake.bin,
      ...updateMrArgs(PIN, '/wt/web-1577', false)
    ])
  })
})
