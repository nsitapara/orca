import type { StrandedWork } from '../../shared/api-types-env'

// git in cwd with args, its stdout; throws when git fails.
export type GitRun = (args: string[], cwd: string) => Promise<string>

function lines(stdout: string): string[] {
  return stdout.split('\n').filter((line) => line.trim() !== '')
}

// What a throwaway still holds that nothing else has, as env delete would keep it: its commits on no origin branch, no
// pilot/ branch and not in its home's HEAD, and its uncommitted or untracked files (ignored ones never, so a gitignored
// env file doesn't count). Null when it holds neither, or when git can't read the folder (gone, or no worktree now).
export async function strandedWork(
  git: GitRun,
  folder: string,
  home: string | null
): Promise<StrandedWork | null> {
  const homeHead = home ? await git(['rev-parse', 'HEAD'], home).catch(() => '') : ''
  try {
    const not = ['--not', '--remotes', '--glob=refs/heads/pilot/*']
    if (homeHead.trim()) {
      not.push(homeHead.trim())
    }
    const commits = lines(await git(['rev-list', 'HEAD', ...not], folder))
    const edits = lines(
      await git(['status', '--porcelain', '--untracked-files=all'], folder)
    ).length
    return commits.length > 0 || edits > 0 ? { commits, edits } : null
  } catch {
    return null
  }
}
