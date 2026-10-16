import { createHash } from 'node:crypto'
import { runProcess } from '@orca/process-host'
import { realpathSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { InboxItemRow } from '../../shared/api-types'
import type { DetailsSnapshot } from '../../shared/details'

// The one canonical diff of a pushed range, base to head: plumbing (diff-tree), with every external hook a
// repository could set (diff.external, a textconv driver from .gitattributes, core.fsmonitor, hooks) switched off,
// the worktree only as -C, and the commits after --end-of-options. The preparation worker makes a push's patch with
// the same argv (pilotcli's `git get-diff`, pilotCLI internal/modules/git; a parity test keeps them
// identical), so Pilot recomputes the same bytes.
export const PUSH_DIFF_ARGS = (worktree: string, base: string, head: string): string[] => [
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'diff.external=',
  '--no-pager',
  '-C',
  worktree,
  'diff-tree',
  '-r',
  '-p',
  '--binary',
  '--full-index',
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--end-of-options',
  base,
  head
]
// A commit is a full object id (SHA-1 or SHA-256), never a ref name or anything git could read as an option.
export const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
export type RangeLimits = { timeoutMs?: number; maxBytes?: number }
const GIT_TIMEOUT_MS = 30_000
const GIT_MAX_BYTES = 64 * 1024 * 1024

// What git runs with, on top of an environment with nothing GIT_* inherited (no GIT_DIR, GIT_WORK_TREE, GIT_CONFIG_*
// or GIT_EXTERNAL_DIFF): no system config, no prompt, no optional locks (read-only), and no fetching at all: no lazy
// fetch of a partial clone's missing objects, no transport or helper but local files. pilotcli's `git get-diff`
// (pilotCLI internal/modules/git) runs git with the same environment (a parity test keeps them identical).
export const PUSH_DIFF_ENV: Readonly<Record<string, string>> = {
  GIT_OPTIONAL_LOCKS: '0',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_NO_LAZY_FETCH: '1',
  GIT_PROTOCOL_FROM_USER: '0',
  GIT_ALLOW_PROTOCOL: 'file'
}

function gitEnv(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
  return { ...env, ...PUSH_DIFF_ENV }
}

function realOrNull(path: string | null): string | null {
  try {
    return path && isAbsolute(path) ? realpathSync(path) : null
  } catch {
    return null
  }
}

// The sha256 of the canonical diff of <base>..<head> in <worktree>, read without blocking the event loop through the
// process host (an argv array, never a shell). Past the timeout or the size cap git is killed and nothing is hashed.
export async function committedRangeSha256(
  worktree: string,
  base: string,
  head: string,
  limits: RangeLimits = {}
): Promise<string> {
  if (!OBJECT_ID.test(base) || !OBJECT_ID.test(head)) {
    throw new Error('a pushed range is two full commit ids')
  }
  const timeoutMs = limits.timeoutMs ?? GIT_TIMEOUT_MS
  const maxBytes = limits.maxBytes ?? GIT_MAX_BYTES
  const result = await runProcess({
    program: 'git',
    args: PUSH_DIFF_ARGS(worktree, base, head),
    env: gitEnv(),
    timeoutMs,
    maxOutputBytes: maxBytes,
    killOnOutputLimit: true,
    captureStdoutAsBytes: true
  })
  if (result.timedOut) {
    throw new Error(`git diff-tree timed out after ${timeoutMs} ms`)
  }
  if (result.outputTruncated) {
    throw new Error(`the pushed range's diff is over ${maxBytes} bytes`)
  }
  if (result.code !== 0 || !result.stdoutBytes) {
    const said = result.stderr.trim().split('\n').pop()
    throw new Error(`git diff-tree failed: ${said || (result.signal ?? result.code)}`)
  }
  return createHash('sha256').update(result.stdoutBytes).digest('hex')
}

// A prepared push binds its patch to what git shows for its pinned range (R-P5): the catalog's push argv is
// [<worktree path>, <branch>, <commit>, <origin commit>] (act.py push), the commits are full object ids, the
// worktree is absolute and resolves to the card's own (the one its run recorded), and every diff's patch_sha256 is
// the sha256 of the canonical diff of origin..commit there.
export async function pushRangeProblems(
  item: InboxItemRow,
  snapshot: DetailsSnapshot
): Promise<string[]> {
  if (item.action !== 'push') {
    return []
  }
  const argv = item.actionArgs?.argv
  if (!Array.isArray(argv) || argv.length !== 4 || !argv.every((a) => typeof a === 'string')) {
    return ['Push requires its pinned worktree, commit and origin commit']
  }
  const [worktree, , head, base] = argv as string[]
  if (!OBJECT_ID.test(head) || !OBJECT_ID.test(base)) {
    return ["Push's commit and origin commit must be full commit ids"]
  }
  const own = realOrNull(item.worktreePath)
  if (!own || realOrNull(worktree) !== own) {
    return ["Push's worktree is not the card's own worktree"]
  }
  let sha: string
  try {
    sha = await committedRangeSha256(own, base, head)
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
