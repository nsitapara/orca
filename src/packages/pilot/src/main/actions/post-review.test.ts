import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { fakePilotcli } from '../envs/__fixtures__/fake-pilotcli'
import { pilotcliRunner, type Pilotcli, type PilotcliReply } from '../envs/pilotcli'
import { RUN_TIMEOUT_MS } from './act-bridge'
import { createThreadArgs, POST_REVIEW_USAGE, postReviewEntry } from './post-review'
import type { ActionCaller, ActionResult } from './types'

const URL = 'https://gitlab.com/polygenx/web-platform/-/merge_requests/1579'
const USAGE = `usage: ${POST_REVIEW_USAGE}`
const CARD: ActionCaller = { runId: 'run-1', inboxItemId: 'in_0000000000000001' }
const REL = 'reviews/1579-815b3867-v1.json'

function part(id: string) {
  return {
    id,
    hash: `h${id}`,
    file: 'a.ts',
    line: 3,
    side: 'new',
    severity: 'minor',
    title: `Finding ${id}`,
    body: 'b',
    in_diff: true,
    comment: 'c',
    context: []
  }
}

// Job 09's folder in a scratch vault, holding one review of !1579 with three findings.
function vault() {
  const reviews = mkdtempSync(join(tmpdir(), 'pilot-post-review-'))
  mkdirSync(join(reviews, 'reviews'))
  const bytes = JSON.stringify({
    iid: 1579,
    title: 'Example MR',
    web_url: URL,
    project: 'polygenx/web-platform',
    head_sha: '815b38670000',
    diff_refs: { base_sha: 'a', head_sha: '815b38670000', start_sha: 'b' },
    reviewer: { name: 'Nish Sitapara', username: 'nish8' },
    parts: [part('1'), part('2'), part('3')]
  })
  writeFileSync(join(reviews, REL), bytes)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return { reviews, sha256, path: join(reviews, REL) }
}

function reply(
  outcome: PilotcliReply['outcome'],
  reason: string,
  data: unknown = null
): PilotcliReply {
  return { outcome, reason, data, code: null }
}

function entryAnswering(answer: PilotcliReply, folder: string | null = '/repos/web-platform') {
  const v = vault()
  const pilotcli = vi.fn<Pilotcli>().mockResolvedValue(answer)
  const at = vi.fn((_caller: ActionCaller) => folder)
  const entry = postReviewEntry({
    pilotcli,
    binary: () => '/bin/pilotcli',
    reviewsDir: () => v.reviews,
    folder: at
  })
  return { ...v, pilotcli, entry, at, args: { argv: ['1579', REL, v.sha256] } }
}

const POSTED = (over: Record<string, unknown> = {}) =>
  reply('ok', '', { posted: 3, of: 3, already: 0, off_line: [], link: URL, ...over })

describe('the post_review action (pilotcli gitlab create-thread)', () => {
  it.each([
    [false, '--dry-run=false'],
    [true, '--dry-run=true']
  ])(
    "posts the pinned review file, named by its path in job 09's folder (dry run %s)",
    async (dryRun, flag) => {
      const { pilotcli, entry, args, path, sha256 } = entryAnswering(POSTED())
      await entry.run(args, { dryRun, runId: CARD.runId, inboxItemId: CARD.inboxItemId })
      expect(pilotcli).toHaveBeenCalledWith({
        args: [
          'gitlab',
          'create-thread',
          '1579',
          `--review=${path}`,
          `--expect-sha256=${sha256}`,
          '--dir=/repos/web-platform',
          flag,
          '--format=json'
        ],
        timeoutMs: RUN_TIMEOUT_MS
      })
    }
  )

  it('leaves out the parts a person left out (--except) and acts in the card’s folder', async () => {
    const { pilotcli, entry, args, at } = entryAnswering(POSTED({ posted: 1, of: 1 }), '/wt/main')
    const leftOut = entry.exceptArgs!(args, ['2', '3'])
    expect(leftOut).toEqual({ argv: [...args.argv, '--except', '2,3'] })
    expect(entry.checkArgs(leftOut)).toBeNull()
    await entry.run(leftOut, { dryRun: false, runId: CARD.runId, inboxItemId: CARD.inboxItemId })
    expect(at).toHaveBeenCalledWith(CARD)
    expect(pilotcli.mock.calls[0][0].args.slice(5)).toEqual([
      '--except=2,3',
      '--dir=/wt/main',
      '--dry-run=false',
      '--format=json'
    ])
  })

  // A config fault (no worktree, no repo checkout Pilot lists) must not close the card as stale on pilotcli's invalid.
  it('fails before any call when no folder names the project', async () => {
    const { pilotcli, entry, args } = entryAnswering(POSTED(), null)
    expect(await entry.run(args, { dryRun: false, runId: 'r' })).toMatchObject({
      outcome: 'failed',
      detail: expect.stringContaining('no folder to run pilotcli in for !1579')
    })
    expect(pilotcli).not.toHaveBeenCalled()
  })

  it.each<[string, PilotcliReply, Partial<ActionResult>]>([
    [
      'every finding posted',
      POSTED(),
      { outcome: 'done', detail: 'posted 3 of 3 findings on !1579', link: URL }
    ],
    [
      'a second run that finds them on the MR',
      POSTED({ posted: 0, of: 2, already: 2 }),
      { outcome: 'done', detail: 'posted 0 of 2 findings on !1579 (2 were already on the MR)' }
    ],
    [
      'line comments GitLab stored as general comments',
      POSTED({ posted: 3, of: 3, off_line: ['1', '3'] }),
      {
        outcome: 'done',
        detail: 'posted 3 of 3 findings on !1579; GitLab put 1, 3 on the MR rather than its line'
      }
    ],
    [
      'a review file that changed',
      reply('skip', '1579-815b3867-v1.json changed after it was shown'),
      { outcome: 'stale', detail: '1579-815b3867-v1.json changed after it was shown', link: null }
    ],
    [
      'an MR that moved',
      reply('skip', '!1579 moved to 9b1c2d3e after the review of 815b3867; prepare it again'),
      {
        outcome: 'stale',
        detail: '!1579 moved to 9b1c2d3e after the review of 815b3867; prepare it again'
      }
    ],
    [
      'a review of another MR',
      reply('invalid', '1579-815b3867-v1.json is a review of !1580, not !1579'),
      { outcome: 'stale', detail: '1579-815b3867-v1.json is a review of !1580, not !1579' }
    ],
    [
      'a part the review lacks',
      reply('invalid', 'no finding 9 in this review'),
      { outcome: 'stale', detail: 'no finding 9 in this review' }
    ],
    [
      'a post GitLab refused',
      reply('failed', 'posted 1, then finding 2 failed: HTTP 500; run again to post the rest', {
        posted: 1,
        of: 3,
        already: 0,
        off_line: [],
        link: URL
      }),
      {
        outcome: 'failed',
        detail: 'posted 1, then finding 2 failed: HTTP 500; run again to post the rest',
        link: URL
      }
    ]
  ])('maps %s', async (_name, answer, expected) => {
    const { entry, args } = entryAnswering(answer)
    expect(await entry.run(args, { dryRun: false, runId: 'r' })).toMatchObject(expected)
  })

  it('says what a dry run would post, as post-review.py did', async () => {
    const { entry, args } = entryAnswering(
      reply('ok', 'would post 2 of 3 findings on !1579 as nish8', {
        posted: 0,
        of: 3,
        already: 1,
        off_line: [],
        link: URL
      })
    )
    expect(await entry.run(args, { dryRun: true, runId: 'r' })).toMatchObject({
      outcome: 'done',
      detail: 'would post 2 of 3 findings on !1579',
      link: URL
    })
  })

  // post-review.py's _parse: the review file must be a .json inside job 09's folder; create-thread no longer checks it.
  it.each<[string, string]>([
    ['a path up and out', '../../x.json'],
    ['an absolute path', '/etc/passwd'],
    ['a path out through the folder', 'reviews/../../elsewhere/r.json'],
    ['a file that is not JSON', 'reviews/1579-815b3867-v1.md'],
    ['the folder itself', '.']
  ])('refuses %s before any call', async (_name, rel) => {
    const { pilotcli, entry, sha256 } = entryAnswering(POSTED())
    const args = { argv: ['1579', rel, sha256] }
    const why = `${rel} isn't a review file in job 09's folder`
    expect(entry.checkArgs(args)).toBe(why)
    expect(entry.command!(args, CARD)).toBeNull()
    expect(await entry.run(args, { dryRun: false, runId: 'r' })).toMatchObject({
      outcome: 'failed',
      detail: why
    })
    expect(pilotcli).not.toHaveBeenCalled()
  })

  it.each<[string, (sha: string) => Record<string, unknown>]>([
    ['an iid that is not a number', (sha) => ({ argv: ['nope', REL, sha] })],
    ['a digest that is not 64 hex', () => ({ argv: ['1579', REL, 'f00d'] })],
    ['--except with no parts', (sha) => ({ argv: ['1579', REL, sha, '--except', ''] })],
    ['a fourth value that is not --except', (sha) => ({ argv: ['1579', REL, sha, '--force'] })],
    ['a key besides argv', (sha) => ({ argv: ['1579', REL, sha], dryRun: false })]
  ])('never runs pilotcli for %s', async (_name, argsOf) => {
    const { pilotcli, entry, sha256 } = entryAnswering(POSTED())
    const args = argsOf(sha256)
    expect(entry.checkArgs(args)).toBe(USAGE)
    expect(entry.command!(args, CARD)).toBeNull()
    expect(await entry.run(args, { dryRun: false, runId: 'r' })).toMatchObject({
      outcome: 'failed',
      detail: USAGE
    })
    expect(pilotcli).not.toHaveBeenCalled()
  })

  it('describes the post from the review file, Pilot-side', async () => {
    const { entry, args, sha256 } = entryAnswering(POSTED())
    expect([entry.name, entry.power]).toEqual(['post_review', 'post'])
    expect(await entry.describe(args)).toBe('Post 3 of 3 findings on !1579')
    expect(await entry.describe(entry.exceptArgs!(args, ['2']))).toBe(
      'Post 2 of 3 findings on !1579'
    )
    const gone = { argv: ['1579', 'reviews/gone.json', sha256] }
    expect(await entry.describe(gone)).toBe('Post the review of !1579 (gone.json is gone)')
    const other = { argv: ['1579', REL, 'f'.repeat(64)] }
    expect(await entry.describe(other)).toBe(
      'Post the review of !1579 (1579-815b3867-v1.json changed after it was shown)'
    )
    expect(entry.refresh).toBeUndefined()
  })

  it('runs what its Run line shows, through the real pilotcli client', async () => {
    const v = vault()
    const fake = fakePilotcli()
    fake.answer('gitlab-create-thread', {
      json: {
        v: 1,
        command: 'gitlab create-thread',
        outcome: 'ok',
        reason: '',
        data: { posted: 3, of: 3, already: 0, off_line: [], link: URL }
      }
    })
    const entry = postReviewEntry({
      pilotcli: pilotcliRunner({ pilotBinDir: '', binary: () => fake.bin, baseEnv: fake.env }),
      binary: () => fake.bin,
      reviewsDir: () => v.reviews,
      folder: () => '/wt/main'
    })
    const args = { argv: ['1579', REL, v.sha256] }
    expect(await entry.run(args, { dryRun: false, runId: 'r' })).toMatchObject({
      outcome: 'done',
      detail: 'posted 3 of 3 findings on !1579'
    })
    const pin = { iid: '1579', path: v.path, sha256: v.sha256, except: null }
    expect(fake.calls()).toEqual([createThreadArgs(pin, '/wt/main', false).join(' ')])
    expect(entry.command!(args, CARD)).toEqual([
      fake.bin,
      ...createThreadArgs(pin, '/wt/main', false)
    ])
  })
})
