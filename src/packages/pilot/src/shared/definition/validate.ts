import { isValidTimeZone, parseCron } from '../schedule/cron'
import { PLACEHOLDER } from '../template'
import type { RawAutomation } from './schema'

export function scheduleErrors(raw: RawAutomation): string[] {
  const errors: string[] = []
  if (raw.schedule !== 'manual') {
    try {
      parseCron(raw.schedule)
    } catch (error) {
      errors.push(`schedule: ${(error as Error).message}`)
    }
  }
  if (raw.timezone && !isValidTimeZone(raw.timezone)) {
    errors.push(`timezone: "${raw.timezone}" isn't an IANA time zone`)
  }
  return errors
}

export function stepErrors(raw: RawAutomation): string[] {
  const errors: string[] = []
  raw.steps.forEach((s, i) => {
    if (s.agent === 'shell') {
      return
    }
    if (s.shell !== undefined) {
      errors.push(`steps[${i}].shell: only shell steps use shell: (shell steps arrive in M3)`)
    }
    if (!s.skill && !s.prompt) {
      errors.push(`step ${i + 1} needs a skill or a prompt`)
    }
  })
  return errors
}

export function quotaErrors(raw: RawAutomation): string[] {
  const errors: string[] = []
  raw.checks?.forEach((c, i) => {
    if (typeof c !== 'object' || !('quota' in c)) {
      return
    }
    for (const field of ['weekly', 'session'] as const) {
      const value = c.quota[field]
      if (value !== undefined && !(value >= 0 && value <= 100)) {
        errors.push(`checks[${i}].quota.${field}: ${value} is out of range 0-100`)
      }
    }
  })
  return errors
}

// A constant key would make the automation run once, ever.
export function oncePerErrors(raw: RawAutomation): string[] {
  if (raw.once_per === undefined || raw.once_per.match(PLACEHOLDER)) {
    return []
  }
  return ['once_per: no {field} placeholder (write {mr.iid}, without spaces)']
}
