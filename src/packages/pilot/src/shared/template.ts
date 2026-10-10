import type { ItemFields } from './api-types'

const FIELD = /\{([a-z_][\w]*(?:\.[\w]+)+|[a-z_][\w]*)\}/gi

export function renderTemplate(
  template: string,
  fields: ItemFields
): { text: string; missing: string[] } {
  const missing = new Set<string>()
  const text = template.replace(FIELD, (whole, name: string) => {
    const value = fields[name]
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
    return `${text}#missing:${missing.join(',')}`
  }
  return text
}
