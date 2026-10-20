import { gitOptionalLocksDisabledEnv } from '../../../../../main/git/command-runner/git-process-env'

export type GitRunner = (
  args: string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv }
) => Promise<{ stdout: string }>

// With no configured trailer every agent loop's commits are ignored (04); 03 passes its own trailer
// line ("Agent-Loop: standards") and ignores exactly that.
export const AGENT_LOOP_PREFIX = 'Agent-Loop:'

export type OwnCommit = { sha: string; at: number }
// What to read at a first sight: nothing more (03 records HEAD), or the branch against its base (04).
export type FirstSightMode = 'baseline' | 'test_recent'
export type CommitFacts = {
  head: string
  marker: string | null
  rewritten: boolean
  firstSight: boolean
  baseRef: string | null
  since: string
  commits: OwnCommit[]
}

// Reads only: optional locks off, so a background read never takes index.lock from an agent there.
async function read(git: GitRunner, cwd: string, args: string[]): Promise<string> {
  const { stdout } = await git(args, { cwd, env: gitOptionalLocksDisabledEnv() })
  return stdout.trim()
}

// Only git's own exit (code 1 "no", 128 "not found"; never a killed child) is an answer. A timeout, an
// abort or a spawn error says nothing about the repo, so it propagates and the item is unreadable.
function isGitExit(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const { code, killed, signal } = error as { code?: unknown; killed?: unknown; signal?: unknown }
  return (code === 1 || code === 128) && !killed && !signal
}

async function succeeds(git: GitRunner, cwd: string, args: string[]): Promise<boolean> {
  try {
    await read(git, cwd, args)
    return true
  } catch (error) {
    if (isGitExit(error)) {
      return false
    }
    throw error
  }
}

function isIgnored(message: string, ignoreTrailer: string | null): boolean {
  return message.split('\n').some((line) => {
    const text = line.trim()
    return ignoreTrailer === null ? text.startsWith(AGENT_LOOP_PREFIX) : text === ignoreTrailer
  })
}

// One record per commit: sha NUL commit-time NUL message RS. A message with an <ignoreTrailer> line
// (any Agent-Loop: line when null) is an agent loop's own fix and doesn't count. Newest first, as git
// log gives them.
export function parseOwnCommits(stdout: string, ignoreTrailer: string | null): OwnCommit[] {
  const commits: OwnCommit[] = []
  for (const record of stdout.split('\u001e')) {
    const trimmed = record.trim()
    if (!trimmed) {
      continue
    }
    const [sha, when, ...message] = trimmed.split('\u0000')
    if (!/^\d+$/.test(when ?? '')) {
      throw new Error(`Unreadable commit time for ${sha}: ${JSON.stringify(when)}`)
    }
    if (isIgnored(message.join('\u0000'), ignoreTrailer)) {
      continue
    }
    commits.push({ sha, at: Number(when) * 1000 })
  }
  return commits
}

// gate.new_commits / due.own_commits: first-parent and non-merge, so a dev merge is never new work.
// With paths, only a commit that changes one of them counts.
export async function ownCommits(
  git: GitRunner,
  path: string,
  since: string,
  ignoreTrailer: string | null,
  paths: readonly string[] = []
): Promise<OwnCommit[]> {
  const args = [
    'log',
    '--first-parent',
    '--no-merges',
    '--format=%H%x00%ct%x00%B%x1e',
    `${since}..HEAD`
  ]
  const { stdout } = await git(paths.length > 0 ? [...args, '--', ...paths] : args, {
    cwd: path,
    env: gitOptionalLocksDisabledEnv()
  })
  return parseOwnCommits(stdout, ignoreTrailer)
}

// gate.evaluate: any non-zero exit (not an ancestor, or a sha this clone lacks) means rewritten.
export function isAncestor(
  git: GitRunner,
  path: string,
  sha: string,
  head: string
): Promise<boolean> {
  return succeeds(git, path, ['merge-base', '--is-ancestor', sha, head])
}

// due.base_ref: where the branch's own work starts: its open MR's target, else the base recorded when
// the worktree was made (branch.<name>.base), else origin/dev.
export async function baseRef(
  git: GitRunner,
  path: string,
  branch: string,
  mrTarget: string | null
): Promise<string> {
  const candidates = mrTarget ? [`origin/${mrTarget}`, mrTarget] : []
  const recorded = await read(git, path, ['config', '--get', `branch.${branch}.base`]).catch(
    (error: unknown) => {
      if (isGitExit(error)) {
        return ''
      }
      throw error
    }
  )
  if (recorded) {
    candidates.push(recorded.replace(/^refs\/heads\//, ''))
  }
  candidates.push('origin/dev')
  for (const ref of candidates) {
    if (await succeeds(git, path, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) {
      return ref
    }
  }
  return 'origin/dev'
}

// What the worktree kind needs to say whether a branch has new work: with a valid marker, its own
// commits since it; at first sight (no marker, or history rewritten), nothing more in `baseline` mode
// (03 records HEAD), or the whole branch against its base in `test_recent` mode (04).
export async function commitFacts(
  git: GitRunner,
  path: string,
  branch: string,
  marker: string | null,
  ignoreTrailer: string | null,
  mode: FirstSightMode,
  mrTarget: string | null,
  paths: readonly string[] = []
): Promise<CommitFacts> {
  const head = await read(git, path, ['rev-parse', 'HEAD'])
  const rewritten = marker !== null && !(await isAncestor(git, path, marker, head))
  if (marker !== null && !rewritten) {
    const commits = await ownCommits(git, path, marker, ignoreTrailer, paths)
    return { head, marker, rewritten, firstSight: false, baseRef: null, since: marker, commits }
  }
  if (mode === 'baseline') {
    return { head, marker, rewritten, firstSight: true, baseRef: null, since: head, commits: [] }
  }
  const base = await baseRef(git, path, branch, mrTarget)
  const since = await read(git, path, ['merge-base', 'HEAD', base])
  const commits = await ownCommits(git, path, since, ignoreTrailer, paths)
  return { head, marker, rewritten, firstSight: true, baseRef: base, since, commits }
}
