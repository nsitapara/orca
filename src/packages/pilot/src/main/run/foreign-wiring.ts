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

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// The real herdr and t3 CLIs. `herdr` from ~/.local/bin, else PATH; `t3` from T3's own install (~/.t3/bin/t3), else PATH.
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
      client: t3CliClient(cliExec(input.t3Bin ?? join(homedir(), '.t3', 'bin', 't3'))),
      checkoutOf: input.checkoutOf
    })
  }
}
