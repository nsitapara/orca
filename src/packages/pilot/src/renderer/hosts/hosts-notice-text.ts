import type { PilotHostEntry, PilotHostRef } from './pilot-host'

type ReadOutcome = { host: PilotHostRef; error: string | null }

// One kind of read (one poll), named in its own words in the lines.
export type NoticeReads = { reads: readonly ReadOutcome[]; what: string }

// A line per machine that failed this kind of read, unless every machine failed it: the page then says it once.
function failedLines(
  hosts: readonly PilotHostEntry[],
  offlineKeys: ReadonlySet<string>,
  { reads, what }: NoticeReads
): string[] {
  const failed = reads.filter((r) => r.error !== null && !offlineKeys.has(r.host.key))
  const listed = new Set(
    [...hosts.map((host) => host.key), ...reads.map((r) => r.host.key)].filter(
      (key) => !offlineKeys.has(key)
    )
  )
  if (new Set(failed.map((r) => r.host.key)).size === listed.size) {
    return []
  }
  return failed.map((r) => `Couldn't refresh ${r.host.machineName}'s ${what}: ${r.error}`)
}

export function hostsNoticeLines(
  hosts: readonly PilotHostEntry[],
  reads: readonly ReadOutcome[],
  what: string,
  also: readonly NoticeReads[] = []
): string[] {
  const offline = hosts.filter((host) => host.state === 'offline')
  const offlineKeys = new Set(offline.map((host) => host.key))
  const lines = [
    ...offline.map(
      (host) => `${host.machineName} can't be reached: its ${what} aren't shown here.`
    ),
    ...[{ reads, what }, ...also].flatMap((group) => failedLines(hosts, offlineKeys, group))
  ]
  // Two machines with one name and one error would repeat a line, and its React key.
  return [...new Set(lines)]
}
