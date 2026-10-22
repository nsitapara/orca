import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { strandedWork, type GitRun } from './stranded'

const execFileAsync = promisify(execFile)
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
const git: GitRun = async (args, cwd) =>
  (await execFileAsync('git', args, { cwd, env: ENV })).stdout

function run(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' }).trim()
}

function commit(cwd: string, file: string, body = file): string {
  writeFileSync(join(cwd, file), body)
  run(cwd, 'add', file)
  run(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', file)
  return run(cwd, 'rev-parse', 'HEAD')
}

// A repo whose main checkout is the home worktree, with a detached throwaway beside it at the home's HEAD, ignoring
// .env.local as web-platform does.
function world() {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-stranded-'))
  const home = join(dir, 'home')
  const folder = join(dir, 'agents-r1')
  execFileSync('git', ['init', '-q', '-b', 'web-1', home], { env: ENV })
  commit(home, '.gitignore', '.env.local\n')
  run(home, 'worktree', 'add', '-q', '--detach', folder)
  writeFileSync(join(folder, '.env.local'), 'SECRET=1\n')
  return { home, folder }
}

describe('strandedWork: what a throwaway holds that nothing else has, as env delete would keep it', () => {
  it.each<[string, (w: ReturnType<typeof world>) => void, number, number]>([
    ['nothing: only its gitignored env file', () => {}, 0, 0],
    ['a commit on no branch', (w) => void commit(w.folder, 'fix.ts'), 1, 0],
    [
      'two commits and an untracked file',
      (w) => {
        commit(w.folder, 'a.ts')
        commit(w.folder, 'b.ts')
        writeFileSync(join(w.folder, 'half.ts'), 'x')
      },
      2,
      1
    ],
    [
      'a commit already in its home',
      (w) => {
        const sha = commit(w.folder, 'fix.ts')
        run(w.home, 'merge', '-q', '--ff-only', sha)
      },
      0,
      0
    ],
    [
      'a commit kept on a pilot/ branch',
      (w) => {
        const sha = commit(w.folder, 'fix.ts')
        run(w.home, 'branch', 'pilot/r1', sha)
      },
      0,
      0
    ]
  ])('%s', async (_name, arrange, commits, edits) => {
    const w = world()
    arrange(w)
    const work = await strandedWork(git, w.folder, w.home)
    if (commits === 0 && edits === 0) {
      expect(work).toBeNull()
    } else {
      expect(work).toMatchObject({ edits })
      expect(work?.commits).toHaveLength(commits)
    }
  })

  it('says nothing once the folder is gone', async () => {
    const w = world()
    rmSync(w.folder, { recursive: true, force: true })
    expect(await strandedWork(git, w.folder, w.home)).toBeNull()
  })
})
