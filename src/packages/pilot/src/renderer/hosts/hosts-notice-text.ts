import type { PilotHostEntry, PilotHostRef } from './pilot-host'

type ReadOutcome = { host: PilotHostRef; error: string | null }

export function hostsNoticeLines(
  hosts: readonly PilotHostEntry[],
  reads: readonly ReadOutcome[],
  what: string
): string[] {
  const offline = hosts.filter((host) => host.state === 'offline')
  const offlineKeys = new Set(offline.map((host) => host.key))
  const lines = offline.map(
    (host) => `${host.machineName} can't be reached: its ${what} aren't shown here.`
  )
  for (const read of reads) {
    // The page reports this machine's own failure itself.
    if (read.error === null || read.host.local || offlineKeys.has(read.host.key)) {
      continue
    }
    lines.push(`Couldn't refresh ${read.host.machineName}'s ${what}: ${read.error}`)
  }
  return lines
}
