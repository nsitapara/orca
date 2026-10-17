import { useEffect, useMemo, useState } from 'react'
import type { AutomationListPayload, PilotStatus } from '../../shared/api-types'
import { pilotRpc } from '../api'
import { useHostPoll, type HostRead } from '../hosts/host-poll'
import { HostsNotice } from '../hosts/HostsNotice'
import { useLoadedAt } from '../hosts/loaded-at'
import { AUTOMATIONS_LIST, mergeAutomationLists } from '../hosts/merge-automations'
import { mergedError } from '../hosts/merge-inbox'
import { AUTOMATIONS_POLL_MS } from '../run-views/automations-feed'
import { AutomationsTable } from './AutomationsTable'
import { setEnabledAll, type Toggle } from './EnabledSwitch'
import { setPilotAutomationsView } from './automations-view'
import { ProblemNotices } from './ProblemNotices'

// The list fails in degraded mode; this machine's pilot.status still says why Pilot didn't start.
function useStartError(reads: readonly HostRead<unknown>[]): string | null {
  const failed = reads.find((r) => r.host.local)?.error ?? null
  const [said, setSaid] = useState<{ after: string; error: string | null } | null>(null)
  useEffect(() => {
    if (failed === null) {
      return undefined
    }
    let alive = true
    pilotRpc<PilotStatus>('pilot.status').then(
      (s) => alive && setSaid({ after: failed, error: s.error }),
      () => alive && setSaid(null)
    )
    return () => {
      alive = false
    }
  }, [failed])
  return said && said.after === failed ? said.error : null
}

// The Automations page's list: Pilot's YAML automations, one row per automation across every machine.
export function PilotAutomationsSection({
  onOpen,
  onOpenJob
}: {
  onOpen: (id: string) => void
  onOpenJob: (jobId: string) => void
}): React.JSX.Element {
  const { reads, reload } = useHostPoll<AutomationListPayload>(
    AUTOMATIONS_LIST,
    undefined,
    AUTOMATIONS_POLL_MS
  )
  const payload = useMemo(() => mergeAutomationLists(reads), [reads])
  const error = mergedError(reads)
  const startError = useStartError(reads)
  const now = useLoadedAt(reads)
  const [refused, setRefused] = useState<string[]>([])
  // The switch settles once the list has reloaded, so it never shows the old state in between.
  const toggle: Toggle = async (rows, enabled) => {
    setRefused(await setEnabledAll(rows, enabled))
    await reload()
  }

  const loading = !payload && !error
  return (
    <section className="flex flex-col gap-3 px-5 pb-6 pt-4">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h2 className="text-sm font-semibold leading-6">Automations</h2>
          <p className="text-xs text-muted-foreground">
            Each automation is a YAML file in an automation folder.
          </p>
        </div>
        <button
          type="button"
          className="text-sm underline"
          onClick={() => setPilotAutomationsView('activity')}
        >
          Activity
        </button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <HostsNotice reads={reads} what="automations" />
      {refused.map((line) => (
        <p key={line} className="text-sm text-destructive">
          {`Couldn't change ${line}`}
        </p>
      ))}
      <ProblemNotices payload={payload} startError={startError} />
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {payload ? (
        <AutomationsTable
          payload={payload}
          now={now}
          onOpen={onOpen}
          onOpenJob={onOpenJob}
          onToggle={toggle}
        />
      ) : null}
    </section>
  )
}
