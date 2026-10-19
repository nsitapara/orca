import { join } from 'node:path'
import { parse } from 'yaml'
import type { FieldValue, ItemFields } from '../../shared/api-types'
import { FRONTMATTER } from '../../shared/run/mode-file'
import { placeholderNames, renderTemplate } from '../../shared/template'
import { TICKET_PRIORITIES, type TicketPriority } from '../../shared/ticket-types'
import { readFirstFile } from '../run/modes'

// The follow-up-ticket skill's template, under a skillSearchDirs folder.
export const TICKET_TEMPLATE_PATH = 'follow-up-ticket/assets/ticket.md'

export type TicketTemplate = {
  path: string
  defaults: {
    team: string
    state: string
    priority: TicketPriority
    labels: string[]
    title: string
  }
  body: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPriority(value: unknown): value is TicketPriority {
  return TICKET_PRIORITIES.some((p) => p === value)
}

function parseFrontmatter(yaml: string, file: string): Record<string, unknown> {
  let meta: unknown
  try {
    meta = parse(yaml)
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    throw new Error(`${file}: frontmatter isn't valid YAML: ${why}`)
  }
  if (!isRecord(meta)) {
    throw new Error(`${file}: frontmatter must be a mapping`)
  }
  return meta
}

function readDefaults(yaml: string, file: string): TicketTemplate['defaults'] {
  const meta = parseFrontmatter(yaml, file)
  const text = (field: string): string => {
    const value = meta[field]
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${file}: ${field} must be a non-empty string`)
    }
    return value
  }
  const team = text('team')
  const state = text('state')
  const { priority, labels } = meta
  if (!isPriority(priority)) {
    throw new Error(`${file}: priority must be one of ${TICKET_PRIORITIES.join(', ')}`)
  }
  if (!Array.isArray(labels) || !labels.every((l): l is string => typeof l === 'string')) {
    throw new Error(`${file}: labels must be a list of strings`)
  }
  return { team, state, priority, labels, title: text('title') }
}

// The first <dir>/follow-up-ticket/assets/ticket.md. No fallback: a missing or broken template throws, naming it.
export function loadTicketTemplate(dirs: string[]): TicketTemplate {
  const tried = dirs.map((dir) => join(dir, TICKET_TEMPLATE_PATH))
  const found = readFirstFile(tried)
  if (!found) {
    throw new Error(`Ticket template not found: ${tried.join(', ')}`)
  }
  const front = FRONTMATTER.exec(found.text)
  if (!front) {
    throw new Error(`${found.file}: frontmatter is missing`)
  }
  return {
    path: found.file,
    defaults: readDefaults(front[1], found.file),
    body: found.text.slice(front[0].length)
  }
}

function isBlank(value: FieldValue | undefined): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

function hasBlankPlaceholder(line: string, fields: ItemFields): boolean {
  return placeholderNames(line).some((name) =>
    isBlank(Object.hasOwn(fields, name) ? fields[name] : undefined)
  )
}

// Whether a non-blank line comes before the next `## ` heading, `---` rule or the end.
function hasContent(lines: string[], from: number): boolean {
  for (const line of lines.slice(from)) {
    if (line.startsWith('## ') || line.trim() === '---') {
      return false
    }
    if (line.trim() !== '') {
      return true
    }
  }
  return false
}

// Lines are dropped on the template's own text, so card text that looks like a heading or rule is never touched.
export function renderTicketBody(body: string, fields: ItemFields): string {
  const filled = body.split('\n').filter((line) => !hasBlankPlaceholder(line, fields))
  const kept = filled.filter((line, i) => !line.startsWith('## ') || hasContent(filled, i + 1))
  const text = kept.map((line) => renderTemplate(line, fields).text).join('\n')
  return text.replace(/\n(?:[^\S\n]*\n){2,}/g, '\n\n').trim()
}
