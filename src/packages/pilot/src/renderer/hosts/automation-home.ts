import type { AutomationSummary } from '../../shared/api-types'
import type { JobGroup } from '../../shared/job-stages'
import { sameMachine } from '../../shared/machine-match'
import { loadMergedAutomations, type MergedAutomation } from './merge-automations'
import { LOCAL_PILOT_HOST, type PilotHostRef } from './pilot-host'
import { withPilotHosts } from './pilot-hosts-feed'

export type AutomationHome =
  | { kind: 'home'; host: PilotHostRef; automations: readonly MergedAutomation[] | null }
  | { kind: 'refused'; reason: string }

function namesText(names: readonly string[]): string {
  if (names.length <= 1) {
    return names.join('')
  }
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

export function notAnsweringText(
  down: readonly PilotHostRef[],
  what: 'automation' | 'job'
): string {
  const names = [...new Set(down.map((host) => host.machineName))]
  const verb = names.length === 1 ? "isn't" : "aren't"
  return `${namesText(names)} ${verb} answering, so this ${what} can't be changed from here right now.`
}

// Acting elsewhere would act on another machine's copy: a row whose runs_on machine isn't answering waits on it, and a
// row no answered list has waits on every machine that isn't answering.
export function waitsOn(
  row: Pick<AutomationSummary, 'runsOn'> | undefined,
  failed: readonly PilotHostRef[]
): PilotHostRef[] {
  if (!row) {
    return [...failed]
  }
  const name = row.runsOn
  return name ? failed.filter((host) => sameMachine(host.machineName, name)) : []
}

// Why a row's own actions are refused right now, or null.
export function rowRefusal(
  row: Pick<AutomationSummary, 'runsOn'> | undefined,
  failed: readonly PilotHostRef[]
): string | null {
  const down = waitsOn(row, failed)
  return down.length > 0 ? notAnsweringText(down, 'automation') : null
}

// The machine an automation's actions go to, or why they can't go anywhere right now.
export function automationHome(id: string): Promise<AutomationHome> {
  return withPilotHosts(async (hosts) => {
    // One machine asks as it did before there were several: no list first.
    if (hosts.length <= 1) {
      return { kind: 'home', host: hosts[0] ?? LOCAL_PILOT_HOST, automations: null }
    }
    const loaded = await loadMergedAutomations()
    const row = loaded.automations.find((a) => a.id === id)
    const reason = rowRefusal(row, loaded.failedHosts)
    if (reason) {
      return { kind: 'refused', reason }
    }
    return { kind: 'home', host: row?.host ?? LOCAL_PILOT_HOST, automations: loaded.automations }
  })
}

// A job's stages that wait on a machine, and why its buttons are refused; null when nothing waits.
export function jobRefusal(
  job: JobGroup | null,
  failed: readonly PilotHostRef[]
): { waiting: ReadonlySet<string>; reason: string | null } {
  const stages = job?.stages.map((s) => ({ id: s.id, down: waitsOn(s, failed) })) ?? []
  const waiting = stages.filter((s) => s.down.length > 0)
  const down = job ? waiting.flatMap((s) => s.down) : waitsOn(undefined, failed)
  return {
    waiting: new Set(waiting.map((s) => s.id)),
    reason: down.length > 0 ? notAnsweringText(down, 'job') : null
  }
}
