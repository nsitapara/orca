import { readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { AutomationSummary } from '../../shared/api-types'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { PilotContext } from '../pilot-services'
import { listAutomations } from './handlers'

const ENABLED_LINE = /^enabled:[ \t]*(?:true|false)\b([^\n]*)$/m
const SCHEDULE_LINE = /^schedule:[^\n]*$/m

// Only the top-level `enabled:` line changes (its comment kept), or one is added under `schedule:`, so
// the file's formatting and comments stay as written.
export function setEnabledInYaml(text: string, enabled: boolean): string {
  const value = enabled ? 'true' : 'false'
  if (ENABLED_LINE.test(text)) {
    return text.replace(ENABLED_LINE, (_line: string, rest: string) => `enabled: ${value}${rest}`)
  }
  if (SCHEDULE_LINE.test(text)) {
    return text.replace(SCHEDULE_LINE, (line) => `${line}\nenabled: ${value}`)
  }
  return `${text.replace(/\n?$/, '\n')}enabled: ${value}\n`
}

function refuse(file: string, enabled: boolean, errors: string[] = []): Error {
  return new Error(
    [`Couldn't set enabled: ${enabled} in ${file}; edit it by hand`, ...errors].join('\n')
  )
}

// pilot.automations.setEnabled. Validates the edited text before writing, writes beside the real file
// (a linked file keeps its link) and renames over it, then reloads.
export function setAutomationEnabled(
  ctx: PilotContext,
  id: string,
  enabled: boolean
): AutomationSummary {
  const def = ctx.loaded().definitions.find((d) => d.id === id)
  if (!def) {
    throw new Error(`No automation "${id}"`)
  }
  const real = realpathSync(def.file)
  const text = readFileSync(real, 'utf8')
  const next = setEnabledInYaml(text, enabled)
  if (next !== text) {
    const check = parseAutomationYaml(next, def.file)
    if (!check.ok) {
      throw refuse(def.file, enabled, check.errors)
    }
    if (check.definition.enabled !== enabled) {
      throw refuse(def.file, enabled)
    }
    const temp = join(dirname(real), `.${basename(real)}.pilot-${process.pid}.tmp`)
    writeFileSync(temp, next)
    renameSync(temp, real)
  }
  ctx.reload()
  const summary = listAutomations(ctx).automations.find((a) => a.id === id)
  if (!summary) {
    throw new Error(`${def.file} didn't load after the change; see pilot automations list-yaml`)
  }
  return summary
}
