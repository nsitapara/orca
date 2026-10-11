import type { ActivityTick, PilotStatus, TickOutcome } from '../shared/api-types'

export function formatPilotStatus(s: PilotStatus): string {
  const missing = new Set(s.missingDirs)
  const dirs = s.automationDirs.map((d) => `  ${d}${missing.has(d) ? ' (missing)' : ''}`)
  const failed = s.error ? [`Pilot couldn't start: ${s.error}`] : []
  const passes = [
    s.loopStartedAt === null ? null : `Scheduler pass started: ${formatTime(s.loopStartedAt)}`,
    s.lastLoopFinishedAt === null ? null : `Last pass finished: ${formatTime(s.lastLoopFinishedAt)}`
  ].filter((line): line is string => line !== null)
  const people = s.peopleError ? [`People: ${s.peopleError}`] : []
  return [
    `Pilot ${s.version} (${s.process})`,
    `Data: ${s.dataPath}`,
    'Automation folders:',
    ...dirs,
    ...failed,
    ...passes,
    ...people
  ].join('\n')
}

export function formatDecisions(result: TickOutcome, id = 'this automation'): string {
  if (result.status === 'busy') {
    return `Tick already running for ${id}`
  }
  if (result.status === 'unknown') {
    return `No automation ${id}`
  }
  if (result.status === 'failed') {
    return `Tick ${result.tickId} · failed: ${result.error}`
  }
  if (result.decisions.length === 0) {
    return `Tick ${result.tickId} · ok\n  No items.`
  }
  const width = Math.max(...result.decisions.map((d) => d.label.length))
  const rows = result.decisions.map(
    (d) => `  ${d.verdict.padEnd(9)} ${d.label.padEnd(width)}  ${d.reason}`
  )
  return [`Tick ${result.tickId} · ok`, ...rows].join('\n')
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

function formatTime(ms: number): string {
  const d = new Date(ms)
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  return `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function formatTickHeader(t: ActivityTick): string {
  const dry = t.dryRun ? ' · dry run' : ''
  const status = t.status === 'failed' ? `failed: ${t.error ?? 'unknown error'}` : t.status
  return `${formatTime(t.startedAt)} · tick ${t.id}${dry} · ${status}`
}

// Ticks arrive newest first; runs show how each started item went (a launch failure is on the run).
export function formatActivity(ticks: ActivityTick[]): string {
  if (ticks.length === 0) {
    return 'No activity yet.'
  }
  return ticks
    .flatMap((t) => [
      formatTickHeader(t),
      ...t.items.map((i) => `  ${i.verdict}  ${i.label}  ${i.reason}`),
      ...t.runs.map((r) => `  run ${r.id} · ${[r.status, r.outcome].filter(Boolean).join(' · ')}`)
    ])
    .join('\n')
}
