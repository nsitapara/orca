type GitRun = (args: string[], options: { cwd: string }) => Promise<{ stdout: string }>

// Deletes the local branch in the repo at path and answers the commit it was at, so it can be restored. update-ref with
// that commit deletes only a branch nothing moved meanwhile.
export async function deleteBranchAtTip(
  git: GitRun,
  path: string,
  branch: string
): Promise<string> {
  const head = (
    await git(['rev-parse', '--verify', `refs/heads/${branch}^{commit}`], { cwd: path })
  ).stdout.trim()
  await git(['update-ref', '-d', `refs/heads/${branch}`, head], { cwd: path })
  return head
}
