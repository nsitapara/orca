import React from 'react'
import type { HostRead } from './host-poll'
import { hostsNoticeLines } from './hosts-notice-text'
import { usePilotHosts } from './pilot-hosts-feed'

export function HostsNotice({
  reads,
  what
}: {
  reads: readonly HostRead<unknown>[]
  what: string
}): React.JSX.Element | null {
  const hosts = usePilotHosts()
  const lines = hostsNoticeLines(hosts, reads, what)
  if (lines.length === 0) {
    return null
  }
  return (
    <div className="flex flex-col gap-1 text-xs text-destructive">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  )
}
