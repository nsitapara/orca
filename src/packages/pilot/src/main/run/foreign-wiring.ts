import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { cliExec, spawnDetached } from './foreign-exec'
import type { ForeignLaunchers } from './foreign-launch'
import { HERDR_SESSION, herdrLauncher } from './herdr-launch'
import { t3CliClient, t3Launcher } from './t3-launch'

export type ForeignWiring = {
  dataDir: string
  now(): number
  // The repo's main checkout: a T3 thread belongs to the project whose folder it is.
  checkoutOf(repo: string): Promise<string>
  // Pilot's resources folder (t3_hook.mjs.txt); none in orcad.
  resourcesDir?: string
  // Tests and smokes: another herdr session, other binaries.
  herdrSession?: string
  herdrBin?: string
  t3Bin?: string
}

// The packaged app's PATH may not hold herdr's install folder.
function defaultHerdr(): string {
  const local = join(homedir(), '.local', 'bin', 'herdr')
  return existsSync(local) ? local : 'herdr'
}

// The branch a worktree has checked out; null when detached or not a git checkout.
async function branchOf(worktree: string): Promise<string | null> {
  const git = cliExec('git', { GIT_OPTIONAL_LOCKS: '0' })
  try {
    const { code, stdout } = await git([
      '-C',
      worktree,
      'symbolic-ref',
      '--quiet',
      '--short',
      'HEAD'
    ])
    return code === 0 && stdout.trim() ? stdout.trim() : null
  } catch {
    return null
  }
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// The real herdr and t3 CLIs. `herdr` from ~/.local/bin, else PATH; `t3` is T3's own launcher (~/.t3/bin/t3), whose app
// and bundled CLI Pilot runs with pilotd's preload.
export function foreignLaunchers(input: ForeignWiring): ForeignLaunchers {
  const session = { HERDR_SESSION: input.herdrSession ?? HERDR_SESSION }
  const herdrBin = input.herdrBin ?? defaultHerdr()
  const dir = join(input.dataDir, 'handover-launchers')
  return {
    herdr: herdrLauncher({
      herdr: cliExec(herdrBin, session),
      startServer: () => {
        mkdirSync(dir, { recursive: true })
        spawnDetached(herdrBin, ['server'], join(dir, 'herdr-server.log'), session)
      },
      launcherDir: dir,
      now: input.now,
      pause
    }),
    t3: t3Launcher({
      client: t3CliClient({
        launcher: input.t3Bin ?? join(homedir(), '.t3', 'bin', 't3'),
        hookPath: input.resourcesDir ? join(input.resourcesDir, 't3_hook.mjs.txt') : null,
        run: (bin, args, env, stdin) => cliExec(bin, env)(args, stdin)
      }),
      checkoutOf: input.checkoutOf,
      branchOf
    })
  }
}
