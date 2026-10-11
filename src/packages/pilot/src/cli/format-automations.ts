import type {
  AutomationDetailPayload,
  AutomationListPayload,
  AutomationSummary
} from '../shared/api-types'

const pad2 = (n: number): string => String(n).padStart(2, '0')

function when(ms: number | null): string {
  if (ms === null) {
    return '—'
  }
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function scheduleText(a: AutomationSummary): string {
  if (a.schedule === 'manual') {
    return 'run by hand'
  }
  return `${a.schedule} (${a.timezone})`
}

function onOff(a: AutomationSummary): string {
  return a.enabled ? 'on' : 'off'
}

export function formatAutomationList(p: AutomationListPayload): string {
  const lines: string[] = []
  if (p.automations.length === 0) {
    lines.push('No automations found.')
  }
  const width = Math.max(0, ...p.automations.map((a) => a.id.length))
  for (const a of p.automations) {
    lines.push(`${onOff(a).padEnd(3)}  ${a.id.padEnd(width)}  ${scheduleText(a)}  ${a.name}`)
  }
  for (const e of p.errors) {
    lines.push(`error ${e.file}: ${e.errors.join(' · ')}`)
  }
  for (const dir of p.missingDirs) {
    lines.push(`missing folder ${dir}`)
  }
  if (p.peopleError) {
    lines.push(`people: ${p.peopleError}`)
  }
  return lines.join('\n')
}

export function formatAutomationDetail(d: AutomationDetailPayload): string {
  const a = d.summary
  const status = a.enabled ? 'Enabled' : 'Paused'
  return [
    `${a.name} (${a.id})`,
    `File: ${a.file}`,
    `Schedule: ${scheduleText(a)}`,
    `Status: ${status}`,
    `Next tick: ${when(a.nextTickAt)}`,
    `Checks: ${d.checkNames.join(', ') || 'none'}`,
    '',
    d.yaml.trimEnd()
  ].join('\n')
}
