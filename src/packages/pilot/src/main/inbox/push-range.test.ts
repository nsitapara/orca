import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { InboxItemRow } from '../../shared/api-types'
import type { DetailsSnapshot } from '../../shared/details'
import { queuedPreparation } from '../../shared/preparation'
import { PilotStore } from '../store/store'
import { detailsFixture, rewriteBundle } from './__fixtures__/details-fixture'
import { completePreparation } from './preparation'
import { PUSH_DIFF_ARGS, pushRangeProblems } from './push-range'

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
      .update(execFileSync('git', ['-C', dir, ...PUSH_DIFF_ARGS(from, to)]))
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
  it('passes when the patch is the canonical diff of the pinned range', () => {
    const r = repo()
    const item = card(r.dir, [r.dir, 'web-1', r.head, r.base])
    expect(pushRangeProblems(item, snapshot(r.sha(r.base, r.head), r.base, r.head))).toEqual([])
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
  ])('refuses %s', (_name, arrange) => {
    const [item, snap] = arrange(repo())
    expect(pushRangeProblems(item, snap)).not.toEqual([])
  })

  it('reads git without taking its optional locks', () => {
    expect(PUSH_DIFF_ARGS('b', 'h')).toEqual([
      '-c',
      'diff.noprefix=false',
      '-c',
      'diff.mnemonicPrefix=false',
      'diff',
      '--binary',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      'b',
      'h'
    ])
  })
})

describe('completing a prepared push', () => {
  it('is refused when its patch is another range than the one it pushes', () => {
    const r = repo()
    const f = detailsFixture()
    const other = execFileSync('git', ['-C', r.dir, ...PUSH_DIFF_ARGS(r.middle, r.head)])
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
    expect(() => completePreparation(deps as never, id, claim, f.bundle)).toThrow('as git shows it')
    expect(store.inbox.get(id)?.preparation?.state).toBe('generating')
  })
})
