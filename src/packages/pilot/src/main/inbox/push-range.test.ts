import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { InboxItemRow } from '../../shared/api-types'
import type { DetailsSnapshot } from '../../shared/details'
import { queuedPreparation } from '../../shared/preparation'
import { PilotStore } from '../store/store'
import { detailsFixture, rewriteBundle } from './__fixtures__/details-fixture'
import { completePreparation } from './preparation'
import {
  committedRangeSha256,
  PUSH_DIFF_ARGS,
  PUSH_DIFF_ENV,
  pushRangeProblems
} from './push-range'

// R-P5 item 2: a prepared push's patch is not taken on its word. Pilot recomputes the pushed range itself, read-only,
// with the one canonical diff command the worker uses (context.py push-patch), and compares the bytes' sha256.
const git = (repo: string, ...args: string[]) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()

function repo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pilot-push-range-')))
  git(dir, 'init', '-q', '-b', 'web-1')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'config', 'user.name', 't')
  const commit = (file: string, text: string) => {
    writeFileSync(join(dir, file), text)
    git(dir, 'add', file)
    git(dir, 'commit', '-qm', file)
    return git(dir, 'rev-parse', 'HEAD')
  }
  const base = commit('a.txt', 'one\n')
  const middle = commit('a.txt', 'one\ntwo\n')
  const head = commit('b.txt', 'three\n')
  const sha = (from: string, to: string) =>
    createHash('sha256')
      .update(execFileSync('git', PUSH_DIFF_ARGS(dir, from, to)))
      .digest('hex')
  return { dir, base, middle, head, sha }
}

const card = (worktree: string | null, argv: string[]) =>
  ({ action: 'push', actionArgs: { argv }, worktreePath: worktree }) as unknown as InboxItemRow
const snapshot = (patchSha: string, base: string, head: string) =>
  ({
    bundle: {
      version: 1,
      blocks: [
        { type: 'diff', patch_kind: 'committed', base, head, patch_sha256: patchSha, files: [] }
      ]
    }
  }) as unknown as DetailsSnapshot

describe('a prepared push range, recomputed by Pilot', () => {
  it('passes when the patch is the canonical diff of the pinned range', async () => {
    const r = repo()
    const item = card(r.dir, [r.dir, 'web-1', r.head, r.base])
    expect(await pushRangeProblems(item, snapshot(r.sha(r.base, r.head), r.base, r.head))).toEqual(
      []
    )
  })

  it.each<[string, (r: ReturnType<typeof repo>) => [InboxItemRow, DetailsSnapshot]]>([
    [
      'a patch of another range',
      (r) => [
        card(r.dir, [r.dir, 'web-1', r.head, r.base]),
        snapshot(r.sha(r.middle, r.head), r.base, r.head)
      ]
    ],
    [
      'a worktree that is not the card’s own',
      (r) => {
        const other = realpathSync(mkdtempSync(join(tmpdir(), 'pilot-elsewhere-')))
        return [
          card(r.dir, [other, 'web-1', r.head, r.base]),
          snapshot(r.sha(r.base, r.head), r.base, r.head)
        ]
      }
    ],
    [
      'a card with no worktree',
      (r) => [
        card(null, [r.dir, 'web-1', r.head, r.base]),
        snapshot(r.sha(r.base, r.head), r.base, r.head)
      ]
    ],
    [
      'a commit git does not have',
      (r) => [
        card(r.dir, [r.dir, 'web-1', 'f'.repeat(40), r.base]),
        snapshot(r.sha(r.base, r.head), r.base, 'f'.repeat(40))
      ]
    ]
  ])('refuses %s', async (_name, arrange) => {
    const [item, snap] = arrange(repo())
    expect(await pushRangeProblems(item, snap)).not.toEqual([])
  })

  it('is plumbing with every external hook off, the worktree only as -C and the commits after --end-of-options', async () => {
    expect(PUSH_DIFF_ARGS('/wt', 'b'.repeat(40), 'h'.repeat(40))).toEqual([
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'diff.external=',
      '--no-pager',
      '-C',
      '/wt',
      'diff-tree',
      '-r',
      '-p',
      '--binary',
      '--full-index',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--end-of-options',
      'b'.repeat(40),
      'h'.repeat(40)
    ])
  })
})

// Security review: the card's argv is untrusted. A commit is a full hex object id or nothing.
describe('the pushed range from untrusted args', () => {
  it.each<[string, (r: ReturnType<typeof repo>, out: string) => string[]]>([
    ['a leading-dash head (an option)', (r, out) => [r.dir, 'web-1', `--output=${out}`, r.base]],
    ['a leading-dash base (an option)', (r, out) => [r.dir, 'web-1', r.head, `--output=${out}`]],
    ['a short commit', (r) => [r.dir, 'web-1', r.head.slice(0, 12), r.base]],
    ['a ref name', (r) => [r.dir, 'web-1', 'web-1', r.base]],
    ['a non-hex commit', (r) => [r.dir, 'web-1', 'z'.repeat(40), r.base]],
    ['a relative worktree', (r) => ['.', 'web-1', r.head, r.base]]
  ])('refuses %s and runs no git', async (_name, argv) => {
    const r = repo()
    const out = join(r.dir, 'written-by-git')
    const item = card(r.dir, argv(r, out))
    expect(
      await pushRangeProblems(item, snapshot(r.sha(r.base, r.head), r.base, r.head))
    ).not.toEqual([])
    expect(existsSync(out)).toBe(false)
  })

  // Job 09 checks out teammates' branches: their repo-local config and attributes must never run anything here.
  it("never runs a repo's diff.external, textconv driver or fsmonitor", async () => {
    const r = repo()
    const marker = (name: string) => join(r.dir, '..', `${name}-${Date.now()}`)
    const markers = ['external', 'textconv', 'fsmonitor'].map(marker)
    git(r.dir, 'config', 'diff.external', `touch ${markers[0]}`)
    git(r.dir, 'config', 'diff.evil.textconv', `touch ${markers[1]}; cat`)
    git(r.dir, 'config', 'core.fsmonitor', `touch ${markers[2]}`)
    writeFileSync(join(r.dir, '.gitattributes'), '* diff=evil\n')
    const item = card(r.dir, [r.dir, 'web-1', r.head, r.base])
    expect(await pushRangeProblems(item, snapshot(r.sha(r.base, r.head), r.base, r.head))).toEqual(
      []
    )
    expect(markers.filter((m) => existsSync(m))).toEqual([])
  })
})

// Fix round 3: a partial clone's promisor remote fetches missing objects through its configured transport, which
// can run a command. The read never fetches: no lazy fetch, no protocol but file.
describe('the pushed range in a partial clone with a hostile promisor remote', () => {
  it('fetches nothing and runs no transport', async () => {
    const r = repo()
    const marker = join(r.dir, '..', `lazy-${Date.now()}`)
    const blob = git(r.dir, 'rev-parse', `${r.head}:b.txt`)
    rmSync(join(r.dir, '.git', 'objects', blob.slice(0, 2), blob.slice(2)))
    git(r.dir, 'config', 'core.repositoryformatversion', '1')
    git(r.dir, 'config', 'extensions.partialClone', 'origin')
    git(r.dir, 'config', 'remote.origin.promisor', 'true')
    git(r.dir, 'config', 'remote.origin.url', `ext::sh -c touch% ${marker}`)
    git(r.dir, 'config', 'protocol.ext.allow', 'always')
    const item = card(r.dir, [r.dir, 'web-1', r.head, r.base])
    expect(await pushRangeProblems(item, snapshot('0'.repeat(64), r.base, r.head))).not.toEqual([])
    expect(existsSync(marker)).toBe(false)
  })

  it('sets the env that forbids it', () => {
    expect(PUSH_DIFF_ENV).toMatchObject({
      GIT_NO_LAZY_FETCH: '1',
      GIT_PROTOCOL_FROM_USER: '0',
      GIT_ALLOW_PROTOCOL: 'file'
    })
  })
})

// Fix round 3: the recompute never blocks Pilot's main thread, and the cap and timeout stop git before any hashing.
describe('reading the pushed range', () => {
  it('lets the event loop run while git works', async () => {
    const r = repo()
    let ticked = false
    const read = committedRangeSha256(r.dir, r.base, r.head)
    setImmediate(() => {
      ticked = true
    })
    expect(await read).toBe(r.sha(r.base, r.head))
    expect(ticked).toBe(true)
  })

  it.each([
    ['over its size cap', { maxBytes: 10 }],
    ['past its timeout', { timeoutMs: 1 }]
  ])('stops git %s and hashes nothing', async (_name, limits) => {
    const r = repo()
    await expect(committedRangeSha256(r.dir, r.base, r.head, limits)).rejects.toThrow()
  })
})

describe('completing a prepared push', () => {
  it('is refused when its patch is another range than the one it pushes', async () => {
    const r = repo()
    const f = detailsFixture()
    const other = execFileSync('git', PUSH_DIFF_ARGS(r.dir, r.middle, r.head))
    writeFileSync(join(f.dir, 'F2.patch'), other)
    const store = PilotStore.open(
      join(mkdtempSync(join(tmpdir(), 'pilot-push-done-')), 'db.sqlite')
    )
    const id = 'in_push000000000001'
    store.inbox.add({
      id,
      automationId: 'ci',
      runId: null,
      stepIdx: null,
      itemKey: 'mr:1',
      worktreePath: r.dir,
      person: 'nish',
      type: 'action',
      title: 'Push !1?',
      context: 'c',
      options: [],
      suggested: null,
      detailsMd: null,
      action: 'push',
      actionArgs: { argv: [r.dir, 'web-1', r.head, r.base] },
      digest: 'd'.repeat(64),
      createdAt: 1,
      source: 'engine',
      vaultRef: null,
      preparation: queuedPreparation(
        { key: 'k', context: 'c', requirements: ['context', 'diff'] },
        1
      )
    })
    store.inboxPreparations.claim(id, 1, 'worker', 0, 2)
    rewriteBundle(f.bundle, (bundle) => {
      bundle.provenance = {
        originatingRunId: null,
        preparingRunId: 'worker',
        itemId: id,
        attempt: 1
      }
      bundle.blocks = [
        { type: 'text', body: 'The pushed range' },
        {
          type: 'diff',
          patch_kind: 'committed',
          base: r.base,
          head: r.head,
          patch: 'F2.patch',
          patch_sha256: createHash('sha256').update(other).digest('hex'),
          files: []
        }
      ]
    })
    const deps = {
      store,
      now: () => 3,
      definitions: () => [],
      people: () => ({ people: [], groups: [] }),
      detailsRoot: f.root
    }
    const claim = { runId: 'worker', stepIdx: 0, revision: 1, attempt: 1 }
    await expect(completePreparation(deps as never, id, claim, f.bundle)).rejects.toThrow(
      'as git shows it'
    )
    expect(store.inbox.get(id)?.preparation?.state).toBe('generating')
  })
})
