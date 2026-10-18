import { describe, expect, it, vi } from 'vitest'
import { fakePilotcli } from '../envs/__fixtures__/fake-pilotcli'
import { pilotcliRunner, type Pilotcli, type PilotcliReply } from '../envs/pilotcli'
import { PUSH_USAGE, pushBranchArgs, pushBranchEntry } from './push-branch'
import { RUN_TIMEOUT_MS, type ActionResult } from './types'

const HEAD = '9c1e2f04'.padEnd(40, 'a')
const BASE = '1a2b3c4d'.padEnd(40, 'b')
const ARGS = { argv: ['/wt/web-1', 'web-1', HEAD, BASE] }
const PINNED = { worktree: '/wt/web-1', branch: 'web-1', head: HEAD, base: BASE }
const USAGE = `usage: ${PUSH_USAGE}`

function reply(
  outcome: PilotcliReply['outcome'],
  reason: string,
  data: unknown = null
): PilotcliReply {
  return { outcome, reason, data, code: null }
}

// The entry over an injected pilotcli that answers once; no process runs.
function entryAnswering(answer: PilotcliReply) {
  const pilotcli = vi.fn<Pilotcli>().mockResolvedValue(answer)
  return { pilotcli, entry: pushBranchEntry({ pilotcli, binary: () => '/bin/pilotcli' }) }
}

describe('the push action (pilotcli git push-branch)', () => {
  it.each([
    [false, '--dry-run=false'],
    [true, '--dry-run=true']
  ])(
    'pushes exactly the pinned range from the card worktree (dry run %s)',
    async (dryRun, flag) => {
      const { pilotcli, entry } = entryAnswering(
        reply('ok', '', { from: BASE, to: HEAD, commits: 1 })
      )
      await entry.run(ARGS, { dryRun, runId: 'r' })
      expect(pilotcli).toHaveBeenCalledWith({
        args: [
          'git',
          'push-branch',
          'web-1',
          `--expect-head=${HEAD}`,
          `--expect-sha=${BASE}`,
          '--dir=/wt/web-1',
          flag,
          '--format=json'
        ],
        timeoutMs: RUN_TIMEOUT_MS
      })
    }
  )

  it.each<[string, PilotcliReply, Partial<ActionResult>]>([
    [
      'a push',
      reply('ok', '', {
        branch: 'web-1',
        worktree: '/wt/web-1',
        from: BASE,
        to: HEAD,
        commits: 2,
        created: false
      }),
      {
        outcome: 'done',
        detail: 'pushed web-1 1a2b3c4d → 9c1e2f04, 2 commits',
        data: { from: BASE, to: HEAD, commits: '2' }
      }
    ],
    [
      'a dry run',
      reply('ok', '', {
        branch: 'web-1',
        worktree: '/wt/web-1',
        from: null,
        created: false,
        would: { from: BASE, to: HEAD, commits: 1, create: false }
      }),
      { outcome: 'done', detail: 'would push web-1 1a2b3c4d → 9c1e2f04, 1 commit' }
    ],
    [
      'a push that already landed',
      reply('skip', 'already published at 9c1e2f0'),
      { outcome: 'done', detail: 'web-1 is already published at 9c1e2f0' }
    ],
    [
      'a pin that moved',
      reply('skip', 'stale: HEAD is now 7f00aa1'),
      { outcome: 'stale', detail: 'not pushed: stale: HEAD is now 7f00aa1', keepOpen: true }
    ],
    [
      'a branch that is not a fast-forward',
      reply('skip', 'not a fast-forward of origin/web-1'),
      { outcome: 'stale', detail: 'not pushed: not a fast-forward of origin/web-1', keepOpen: true }
    ],
    [
      'uncommitted changes',
      reply('not_yet', 'uncommitted changes'),
      { outcome: 'not_yet', detail: 'uncommitted changes (web-1 in /wt/web-1)', onYou: true }
    ],
    [
      'a base branch',
      reply('invalid', 'dev is a base branch'),
      { outcome: 'failed', detail: 'pilotcli refused the push: dev is a base branch' }
    ],
    [
      'a hook that declined',
      reply('failed', 'push failed', {
        output: ['To gitlab.com:x.git', 'b', 'remote: GitLab: declined', 'error: failed to push']
      }),
      {
        outcome: 'failed',
        detail: 'push failed · b · remote: GitLab: declined · error: failed to push'
      }
    ],
    [
      'origin out of reach',
      reply('failed', 'origin unreachable'),
      { outcome: 'failed', detail: 'origin unreachable' }
    ]
  ])('maps %s', async (_name, answer, expected) => {
    const { entry } = entryAnswering(answer)
    expect(await entry.run(ARGS, { dryRun: false, runId: 'r' })).toMatchObject(expected)
  })

  it('keeps only a skip other than "already published" open', async () => {
    for (const answer of [
      reply('ok', '', {}),
      reply('skip', 'already published at 9c1e2f0'),
      reply('failed', 'x')
    ]) {
      const { entry } = entryAnswering(answer)
      expect((await entry.run(ARGS, { dryRun: false, runId: 'r' })).keepOpen).toBeUndefined()
    }
  })

  // Nothing from a card reaches a command line unchecked: the worktree is absolute, the branch can't read as a flag or
  // as one of push-branch's field=value conditions, and both commits are full object ids.
  it.each<[string, Record<string, unknown>]>([
    ['a relative worktree', { argv: ['wt/web-1', 'web-1', HEAD, BASE] }],
    ['a branch that reads as a flag', { argv: ['/wt/web-1', '--force', HEAD, BASE] }],
    ['a branch that reads as a condition', { argv: ['/wt/web-1', 'mine=false', HEAD, BASE] }],
    ['a short commit', { argv: ['/wt/web-1', 'web-1', 'abc123', BASE] }],
    ['a ref name for the origin commit', { argv: ['/wt/web-1', 'web-1', HEAD, 'origin/web-1'] }],
    ['an upper-case commit', { argv: ['/wt/web-1', 'web-1', HEAD.toUpperCase(), BASE] }],
    ['three values', { argv: ['/wt/web-1', 'web-1', HEAD] }],
    ['a key besides argv', { ...ARGS, force: true }]
  ])('never runs pilotcli for %s', async (_name, args) => {
    const { pilotcli, entry } = entryAnswering(reply('ok', ''))
    expect(entry.checkArgs(args)).toBe(USAGE)
    expect(entry.command!(args)).toBeNull()
    expect(await entry.run(args, { dryRun: false, runId: 'r' })).toMatchObject({
      outcome: 'failed',
      detail: USAGE
    })
    expect(pilotcli).not.toHaveBeenCalled()
  })

  it('runs what its Run line shows, through the real pilotcli client', async () => {
    const fake = fakePilotcli()
    fake.answer('git-push-branch', {
      json: {
        v: 1,
        command: 'git push-branch',
        outcome: 'ok',
        reason: '',
        data: {
          branch: 'web-1',
          worktree: '/wt/web-1',
          from: BASE,
          to: HEAD,
          commits: 1,
          created: false
        }
      }
    })
    const entry = pushBranchEntry({
      pilotcli: pilotcliRunner({ pilotBinDir: '', binary: () => fake.bin, baseEnv: fake.env }),
      binary: () => fake.bin
    })
    expect(await entry.run(ARGS, { dryRun: false, runId: 'r' })).toMatchObject({
      outcome: 'done',
      detail: 'pushed web-1 1a2b3c4d → 9c1e2f04, 1 commit'
    })
    expect(fake.calls()).toEqual([pushBranchArgs(PINNED, false).join(' ')])
    expect(entry.command!(ARGS)).toEqual([fake.bin, ...pushBranchArgs(PINNED, false)])
    expect(await entry.describe(ARGS)).toBe('Push web-1 to origin, 1a2b3c4d → 9c1e2f04')
  })
})
