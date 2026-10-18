import { sameMachine } from '../../shared/machine-match'
import { refOf } from './answered-reads'
import { rowRefusal } from './automation-home'
import type { MergedAutomation } from './merge-automations'
import type { PilotHostEntry, PilotHostRef } from './pilot-host'

export type RunNowChoice = { host: PilotHostRef; label: string; disabled: string | null }
export type RunNowChoices = { choices: RunNowChoice[]; preferred: string | null }

const NO_MACHINE = 'No connected Pilot can start this automation right now.'

function schedulerOffText(name: string): string {
  return `Pilot's scheduler is off on ${name}`
}

// A run started on a machine waits on it as a row pinned there does, so the shared predicate words why.
function whyNot(host: PilotHostRef, hosts: readonly PilotHostEntry[]): string | null {
  const entry = hosts.find((h) => h.key === host.key)
  // By key first: the name predicate would let a same-named machine stand in for it.
  if (!entry) {
    return `${host.machineName} isn't connected any more`
  }
  const down = entry.state !== 'online' ? [entry] : []
  const held = rowRefusal({ runsOn: host.machineName }, { listedHosts: hosts, failedHosts: down })
  if (held) {
    return held
  }
  // tickNow refuses where the scheduler is off; null (not reported) is left for that machine to answer.
  return entry.schedulerOn === false ? schedulerOffText(host.machineName) : null
}

function enabledKey(
  choices: readonly RunNowChoice[],
  match: (c: RunNowChoice) => boolean
): string | null {
  return choices.find((c) => c.disabled === null && match(c))?.host.key ?? null
}

// Each machine that loaded the job, disabled with why not; the default is runs_on's, else this one, else any other.
export function runNowChoices(
  row: Pick<MergedAutomation, 'runsOn' | 'hosts'>,
  hosts: readonly PilotHostEntry[]
): RunNowChoices {
  const loaded = row.hosts.filter((h, i) => row.hosts.findIndex((o) => o.key === h.key) === i)
  const choices = loaded.map((ref) => {
    const entry = hosts.find((h) => h.key === ref.key)
    const host = entry ? refOf(entry) : ref
    return { host, label: host.machineName, disabled: whyNot(host, hosts) }
  })
  const name = row.runsOn?.trim()
  const preferred =
    (name ? enabledKey(choices, (c) => sameMachine(c.label, name)) : null) ??
    enabledKey(choices, (c) => c.host.local) ??
    enabledKey(choices, () => true)
  return { choices, preferred }
}

// The machine a confirmed Run now goes to: the one chosen while it can still start it, else the default.
export function runNowPick(choices: RunNowChoices, chosen: string | null): RunNowChoice | null {
  const usable = (key: string | null) =>
    choices.choices.find((c) => c.host.key === key && c.disabled === null)
  return usable(chosen) ?? usable(choices.preferred) ?? null
}

// Why Run now can't start anywhere, or null while some machine can.
export function runNowBlocked(choices: RunNowChoices): string | null {
  if (choices.preferred !== null) {
    return null
  }
  const reasons = choices.choices.flatMap((c) => (c.disabled ? [c.disabled] : []))
  return reasons.length > 0 ? reasons.join(' · ') : NO_MACHINE
}
