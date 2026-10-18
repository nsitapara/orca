import type { AutomationSummary } from '../../shared/api-types'
import type { JobGroup } from '../../shared/job-stages'
import { sameMachine } from '../../shared/machine-match'
import {
  loadMergedAutomations,
  type ListedMachines,
  type MergedAutomation
} from './merge-automations'
import { LOCAL_PILOT_HOST, type PilotHostRef } from './pilot-host'
import { withPilotHosts } from './pilot-hosts-feed'

export type AutomationHome =
  | { kind: 'home'; host: PilotHostRef; automations: readonly MergedAutomation[] | null }
  | { kind: 'refused'; reason: string }

type What = 'automation' | 'job'
type Row = Pick<AutomationSummary, 'runsOn'>

const NONE_PENDING: ReadonlySet<string> = new Set()

function namesText(names: readonly string[], join = 'and'): string {
  if (names.length <= 1) {
    return names.join('')
  }
  return `${names.slice(0, -1).join(', ')} ${join} ${names.at(-1)}`
}

function hostNames(hosts: readonly PilotHostRef[]): string[] {
  return [...new Set(hosts.map((host) => host.machineName))]
}

// Each machine once, as first written: runs_on matches in any case.
function machineNames(names: readonly string[]): string[] {
  return names.filter((name, i) => names.findIndex((n) => sameMachine(n, name)) === i)
}

export function notAnsweringText(down: readonly PilotHostRef[], what: What): string {
  const names = hostNames(down)
  const verb = names.length === 1 ? "isn't" : "aren't"
  return `${namesText(names)} ${verb} answering, so this ${what} can't be changed from here right now.`
}

function waitingText(pending: readonly PilotHostRef[]): string {
  const names = hostNames(pending)
  const lists = names.length === 1 ? 'list' : 'lists'
  return `Waiting for ${namesText(names.map((name) => `${name}'s`))} ${lists}…`
}

function missingText(names: readonly string[], what: What): string {
  return `No connected Pilot is named ${namesText(names, 'or')}, so this ${what} can't be changed from here.`
}

// So nothing acts on another copy: a row waits on its runs_on machine while down, an unlisted row on any that's down.
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

// What a row's actions wait on: listed machines not answering, ones yet to answer, and a runs_on no listed machine has.
type Hold = { down: PilotHostRef[]; pending: PilotHostRef[]; missing: string[] }

// Alone, this machine doesn't know its own name, so a runs_on is never missing then.
function missingMachine(row: Row | undefined, listed: readonly PilotHostRef[]): string[] {
  const name = row?.runsOn?.trim()
  if (!name || listed.length <= 1 || listed.some((host) => sameMachine(host.machineName, name))) {
    return []
  }
  return [name]
}

function holdOf(row: Row | undefined, machines: ListedMachines): Hold {
  const failed = waitsOn(row, machines.failedHosts)
  const pending = machines.pendingHosts ?? NONE_PENDING
  return {
    down: failed.filter((host) => !pending.has(host.key)),
    pending: failed.filter((host) => pending.has(host.key)),
    missing: missingMachine(row, machines.listedHosts)
  }
}

function joinHolds(holds: readonly Hold[]): Hold {
  return {
    down: holds.flatMap((h) => h.down),
    pending: holds.flatMap((h) => h.pending),
    missing: machineNames(holds.flatMap((h) => h.missing))
  }
}

function heldText(hold: Hold, what: What): string | null {
  const lines = [
    ...(hold.down.length > 0 ? [notAnsweringText(hold.down, what)] : []),
    ...(hold.pending.length > 0 ? [waitingText(hold.pending)] : []),
    ...(hold.missing.length > 0 ? [missingText(hold.missing, what)] : [])
  ]
  return lines.length > 0 ? lines.join(' ') : null
}

// Why a row's own actions are refused right now, or null.
export function rowRefusal(row: Row | undefined, machines: ListedMachines): string | null {
  return heldText(holdOf(row, machines), 'automation')
}

// The list's one line while any of its rows is refused, naming the machines they wait on.
export function listRefusal(
  rows: readonly Row[],
  machines: ListedMachines
): { text: string; warn: boolean } | null {
  const hold = joinHolds(rows.map((row) => holdOf(row, machines)))
  const stuck = machineNames([...hostNames(hold.down), ...hold.missing])
  if (stuck.length > 0) {
    return {
      text: `Automations that run on ${namesText(stuck)} can't be changed from here.`,
      warn: true
    }
  }
  return hold.pending.length > 0 ? { text: waitingText(hold.pending), warn: false } : null
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
    const reason = rowRefusal(row, loaded)
    if (reason) {
      return { kind: 'refused', reason }
    }
    return { kind: 'home', host: row?.host ?? LOCAL_PILOT_HOST, automations: loaded.automations }
  })
}

// A job's stages that wait on a machine, and why its buttons are refused; null when nothing waits.
export function jobRefusal(
  job: JobGroup | null,
  machines: ListedMachines
): { waiting: ReadonlySet<string>; reason: string | null } {
  const stages = job?.stages.map((s) => ({ id: s.id, hold: holdOf(s, machines) })) ?? []
  const waiting = stages.filter((s) => s.hold.down.length + s.hold.pending.length > 0)
  const hold = job ? joinHolds(stages.map((s) => s.hold)) : holdOf(undefined, machines)
  return { waiting: new Set(waiting.map((s) => s.id)), reason: heldText(hold, 'job') }
}
