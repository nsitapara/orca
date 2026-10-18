import { createContext, useContext } from 'react'
import type { AutomationSummary } from '../../shared/api-types'
import { jobEnabled, jobTitle, type JobGroup } from '../../shared/job-stages'
import { jobRefusal, rowRefusal } from '../hosts/automation-home'
import type { ListedMachines } from '../hosts/merge-automations'
import { hostOf, type PilotHostRef } from '../hosts/pilot-host'
import { EnabledSwitch, type Toggle, type ToggleRow } from './EnabledSwitch'

// The listed machines as the page last read them: a row whose runs_on machine isn't answering, or isn't listed, won't
// switch here.
export const MachinesContext = createContext<ListedMachines>({ listedHosts: [], failedHosts: [] })

// A row of the merged list names its home; a list from one machine doesn't.
type HomedAutomation = AutomationSummary & { host?: PilotHostRef }

function toggleRow(a: HomedAutomation): ToggleRow {
  return { id: a.id, host: hostOf(a) }
}

function statusText(enabled: boolean): string {
  return enabled ? 'Enabled' : 'Paused'
}

function jobStatusText(job: JobGroup): string {
  const on = job.stages.filter((s) => s.enabled).length
  if (on > 0 && on < job.stages.length) {
    return 'Partly on'
  }
  return statusText(on > 0)
}

// A job's switch is on while any stage is: flipping it off turns every stage off, flipping it on turns every one on.
export function JobSwitch({
  job,
  onToggle
}: {
  job: JobGroup<HomedAutomation>
  onToggle: Toggle
}): React.JSX.Element {
  const on = jobEnabled(job)
  const rows = job.stages.filter((s) => s.enabled === on).map(toggleRow)
  const machines = useContext(MachinesContext)
  return (
    <EnabledSwitch
      name={`Job ${jobTitle(job)}`}
      on={on}
      text={jobStatusText(job)}
      refusal={jobRefusal(job, machines).reason}
      onToggle={() => onToggle(rows, !on)}
    />
  )
}

export function AutomationSwitch({
  a,
  name,
  onToggle
}: {
  a: HomedAutomation
  name: string
  onToggle: Toggle
}): React.JSX.Element {
  const machines = useContext(MachinesContext)
  return (
    <EnabledSwitch
      name={name}
      on={a.enabled}
      text={statusText(a.enabled)}
      refusal={rowRefusal(a, machines)}
      onToggle={() => onToggle([toggleRow(a)], !a.enabled)}
    />
  )
}
