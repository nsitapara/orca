import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import type { InboxItemRow } from '../../shared/api-types'
import type { DetailsSnapshot } from '../../shared/details'

// The one canonical diff of a pushed range, base to head. The preparation worker makes a push's patch with the same
// arguments (~/.agents/skills/prepare-inbox-item-context/scripts/context.py push-patch, PUSH_DIFF; a parity test
// keeps them equal), so Pilot can recompute the bytes itself. The -c settings pin the a/ b/ prefixes a user's
// config could change.
export const PUSH_DIFF_ARGS = (base: string, head: string): string[] => [
  '-c',
  'diff.noprefix=false',
  '-c',
  'diff.mnemonicPrefix=false',
  'diff',
  '--binary',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  base,
  head
]
const GIT_TIMEOUT_MS = 30_000
const GIT_MAX_BYTES = 64 * 1024 * 1024

function realOrNull(path: string | null): string | null {
  try {
    return path ? realpathSync(path) : null
  } catch {
    return null
  }
}

// The sha256 of the canonical diff of <base>..<head> in <worktree>, read-only (no optional locks).
export function committedRangeSha256(worktree: string, base: string, head: string): string {
  const bytes = execFileSync('git', ['-C', worktree, ...PUSH_DIFF_ARGS(base, head)], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BYTES,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return createHash('sha256').update(bytes).digest('hex')
}

// A prepared push binds its patch to what git shows for its pinned range (R-P5): the catalog's push argv is
// [<worktree path>, <branch>, <commit>, <origin commit>] (act.py push), the worktree must be the card's own (the one
// its run recorded), and every diff's patch_sha256 must be the sha256 of the canonical diff of origin..commit there.
export function pushRangeProblems(item: InboxItemRow, snapshot: DetailsSnapshot): string[] {
  if (item.action !== 'push') {
    return []
  }
  const argv = item.actionArgs?.argv
  if (!Array.isArray(argv) || argv.length !== 4 || !argv.every((a) => typeof a === 'string')) {
    return ['Push requires its pinned worktree, commit and origin commit']
  }
  const [worktree, , head, base] = argv as string[]
  const own = realOrNull(item.worktreePath)
  if (!own || realOrNull(worktree) !== own) {
    return ["Push's worktree is not the card's own worktree"]
  }
  let sha: string
  try {
    sha = committedRangeSha256(own, base, head)
  } catch (error) {
    return [`Pilot couldn't read the pushed range from git: ${String(error).slice(0, 300)}`]
  }
  const diffs = snapshot.bundle.blocks.filter((block) => block.type === 'diff')
  if (diffs.length === 0 || diffs.some((block) => block.patch_sha256 !== sha)) {
    return [
      `Prepared patch is not the pushed range ${base.slice(0, 8)}..${head.slice(0, 8)} as git shows it`
    ]
  }
  return []
}
