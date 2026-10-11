import type { PilotStatus } from '../shared/api-types'

export function formatPilotStatus(s: PilotStatus): string {
  const missing = new Set(s.missingDirs)
  const dirs = s.automationDirs.map((d) => `  ${d}${missing.has(d) ? ' (missing)' : ''}`)
  const failed = s.error ? [`Pilot couldn't start: ${s.error}`] : []
  const people = s.peopleError ? [`People: ${s.peopleError}`] : []
  return [
    `Pilot ${s.version} (${s.process})`,
    `Data: ${s.dataPath}`,
    'Automation folders:',
    ...dirs,
    ...failed,
    ...people
  ].join('\n')
}
