import {
  AgentArtifactSchema,
  type AgentArtifact,
  type ArtifactsListParams,
  type ArtifactsPayload
} from '../../shared/api-types-artifacts'
import type { Pilotcli, PilotcliReply } from '../envs/pilotcli'

export const ARTIFACTS_ARGS = [
  'artifacts',
  'list-artifacts',
  '--format',
  'json',
  '--limit',
  '0'
] as const
// The first read scans every Claude transcript; later ones only the changed files.
export const ARTIFACTS_TIMEOUT_MS = 120_000
export const ARTIFACTS_FRESH_MS = 30_000
// How long a call waits for a read in flight before answering with what it has (refreshing: true).
export const ARTIFACTS_WAIT_MS = 10_000
export const ARTIFACTS_MAX_OUTPUT_BYTES = 32 * 1024 * 1024
export const NEEDS_ARTIFACTS_PILOTCLI =
  'This pilotcli has no artifacts index yet: install a newer one (artifacts list-artifacts)'
export const UNREADABLE_ARTIFACTS = "pilotcli answered in a shape Pilot doesn't read"

const UNKNOWN_COMMAND = /unknown (module|command)/i

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The artifacts in a list-artifacts reply, or why there are none. A row that doesn't parse is left out. */
export function readArtifacts(
  reply: PilotcliReply
): { artifacts: AgentArtifact[] } | { error: string } {
  if (reply.outcome !== 'ok') {
    if (reply.outcome === 'invalid' && UNKNOWN_COMMAND.test(reply.reason)) {
      return { error: NEEDS_ARTIFACTS_PILOTCLI }
    }
    return { error: reply.reason || `pilotcli artifacts list-artifacts: ${reply.outcome}` }
  }
  if (reply.data === null) {
    return { artifacts: [] }
  }
  if (!Array.isArray(reply.data)) {
    return { error: UNREADABLE_ARTIFACTS }
  }
  const artifacts: AgentArtifact[] = []
  for (const row of reply.data) {
    const parsed = AgentArtifactSchema.safeParse(row)
    if (parsed.success) {
      artifacts.push(parsed.data)
    }
  }
  return { artifacts }
}

export type ArtifactsService = { list(p: ArtifactsListParams): Promise<ArtifactsPayload> }

// This machine's artifacts index, read through pilotcli. One read at a time, shared by every caller; a read is
// reused for ARTIFACTS_FRESH_MS unless a caller asks to refresh.
export function artifactsService(deps: {
  pilotcli: Pilotcli
  now?: () => number
  waitMs?: number
}): ArtifactsService {
  const now = deps.now ?? Date.now
  const waitMs = deps.waitMs ?? ARTIFACTS_WAIT_MS
  let fetchedAt: number | null = null
  let artifacts: AgentArtifact[] = []
  let error: string | null = null
  let triedAt: number | null = null
  let running: Promise<void> | null = null

  function take(reply: PilotcliReply): void {
    const read = readArtifacts(reply)
    if ('error' in read) {
      error = read.error
      return
    }
    artifacts = read.artifacts
    error = null
    fetchedAt = now()
  }

  function start(): Promise<void> {
    running ??= deps
      .pilotcli({
        args: ARTIFACTS_ARGS,
        timeoutMs: ARTIFACTS_TIMEOUT_MS,
        maxOutputBytes: ARTIFACTS_MAX_OUTPUT_BYTES
      })
      .then(take, (e: unknown) => {
        error = messageOf(e)
      })
      .finally(() => {
        triedAt = now()
        running = null
      })
    return running
  }

  async function settle(run: Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const waited = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, waitMs)
    })
    await Promise.race([run, waited])
    clearTimeout(timer)
  }

  return {
    async list(p) {
      const stale = triedAt === null || now() - triedAt >= ARTIFACTS_FRESH_MS
      const run = running ?? (p.refresh || stale ? start() : null)
      if (run) {
        await settle(run)
      }
      return { fetchedAt, artifacts, error, refreshing: running !== null }
    }
  }
}
