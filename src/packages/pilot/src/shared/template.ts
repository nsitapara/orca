import type { ItemFields, StepRow } from './api-types'

// Global flag: use with match()/replace(), never .test()/.exec() (lastIndex is stateful).
export const PLACEHOLDER = /\{([a-z_][\w]*(?:\.[\w]+)+|[a-z_][\w]*)\}/gi

export function renderTemplate(
  template: string,
  fields: ItemFields
): { text: string; missing: string[] } {
  const missing = new Set<string>()
  const text = template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = Object.hasOwn(fields, name) ? fields[name] : undefined
    if (value === undefined || value === null) {
      missing.add(name)
      return whole
    }
    return String(value)
  })
  return { text, missing: [...missing] }
}

export function oncePerKey(template: string | null, fields: ItemFields, itemKey: string): string {
  if (!template) {
    return itemKey
  }
  const { text, missing } = renderTemplate(template, fields)
  if (missing.length) {
    return `${text}#missing:${missing.join(',')}#${itemKey}`
  }
  return text
}

// Each placeholder name once, in order (the names renderTemplate would fill).
export function placeholderNames(template: string): string[] {
  return [...new Set(Array.from(template.matchAll(PLACEHOLDER), (m) => m[1]))]
}

const dateFormats = new Map<string, Intl.DateTimeFormat>()

function localDate(at: number, timeZone: string): string {
  let format = dateFormats.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    dateFormats.set(timeZone, format)
  }
  const parts = Object.fromEntries(format.formatToParts(new Date(at)).map((p) => [p.type, p.value]))
  return `${parts.year}${parts.month}${parts.day}`
}

// run.* (contract §4). run.tick is the tick's id, run.id is there only once a run exists.
export function runFields(r: {
  automationId: string
  at: number
  timezone: string
  runId?: string
  tickId?: number
}): ItemFields {
  const fields: ItemFields = {
    'run.automation': r.automationId,
    'run.date': localDate(r.at, r.timezone)
  }
  if (r.tickId !== undefined) {
    fields['run.tick'] = r.tickId
  }
  if (r.runId) {
    fields['run.id'] = r.runId
  }
  return fields
}

export type StepResult = Pick<StepRow, 'name' | 'status' | 'exitCode' | 'outputs'>

// steps.<name>.<output|exit_code|status> for every step before `current`, and previous.* for the one
// just before it. A step's own status and exit code win over an output of the same name.
export function stepFields(steps: StepResult[], current: number): ItemFields {
  const fields: ItemFields = {}
  steps.slice(0, current).forEach((step, i) => {
    const own: ItemFields = { ...step.outputs, exit_code: step.exitCode, status: step.status }
    for (const [key, value] of Object.entries(own)) {
      fields[`steps.${step.name}.${key}`] = value
      if (i === current - 1) {
        fields[`previous.${key}`] = value
      }
    }
  })
  return fields
}
