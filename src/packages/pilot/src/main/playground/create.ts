import { z } from 'zod'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { pilotcliPath, pilotcliRunner, type PilotcliReply } from '../envs/pilotcli'
import { playgroundService, type PlaygroundService } from './playground'

export type { PlaygroundService } from './playground'
import { spawnPlayground } from './spawn'

const GET_CONFIG_TIMEOUT_MS = 10_000

// get-config's data, as far as the playground reads it: worktree is null for a repo pilotcli doesn't know.
const GetConfigData = z.object({ worktree: z.object({ project: z.string().min(1) }) })

// The project `pilotcli self get-config -C <repo>` names, or null when pilotcli doesn't know the repo.
export function projectIn(reply: PilotcliReply): string | null {
  const parsed = reply.outcome === 'ok' ? GetConfigData.safeParse(reply.data) : null
  return parsed?.success ? parsed.data.worktree.project : null
}

const PROJECT_CACHE_MS = 60_000

// projectOf, remembered per repo for a minute: the page asks on every load, and each ask is a pilotcli call and a
// telemetry line.
export function rememberedProjectOf(
  projectOf: (repoPath: string) => Promise<string | null>,
  now: () => number = Date.now,
  ttlMs = PROJECT_CACHE_MS
): (repoPath: string) => Promise<string | null> {
  const seen = new Map<string, { at: number; project: Promise<string | null> }>()
  return (repoPath) => {
    const hit = seen.get(repoPath)
    if (hit && now() - hit.at < ttlMs) {
      return hit.project
    }
    const project = projectOf(repoPath)
    seen.set(repoPath, { at: now(), project })
    return project
  }
}

// The playground of the desktop app: the repos Pilot lists, pilotcli as installed, View source through Pilot's CLI.
export function createPlayground(opts: {
  listRepos: () => { path: string; displayName: string }[]
  pilotBinDir: string
}): PlaygroundService {
  const pilotcli = pilotcliRunner({ pilotBinDir: opts.pilotBinDir })
  return playgroundService({
    repos: opts.listRepos,
    projectOf: rememberedProjectOf(async (repoPath) =>
      projectIn(
        await pilotcli({
          args: ['self', 'get-config', '-C', repoPath, '--format', 'json'],
          timeoutMs: GET_CONFIG_TIMEOUT_MS
        })
      )
    ),
    spawn: spawnPlayground({ binary: () => pilotcliPath(), pilotBinDir: opts.pilotBinDir })
  })
}

// The playground of a process with a launcher folder (desktop, serve), closed with the rest of Pilot. orcad has none:
// View source needs Pilot's CLI.
export function openPlayground(
  runtime: OrcaRuntimeService,
  pilotBinDir: string,
  opened: (() => void)[]
): PlaygroundService | undefined {
  if (!pilotBinDir) {
    return undefined
  }
  const playground = createPlayground({ listRepos: () => runtime.listRepos(), pilotBinDir })
  opened.push(() => playground.close())
  return playground
}
