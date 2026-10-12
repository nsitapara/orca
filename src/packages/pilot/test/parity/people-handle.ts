import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { portedAutomationsDir } from './ported'

// The Linear account people.yaml gives <person>, so test items carry the assignee the people refs match.
export function linearHandleOf(person: string): string {
  const file = join(portedAutomationsDir(), 'people.yaml')
  const doc = parse(readFileSync(file, 'utf8')) as { people: { id: string; linear?: string }[] }
  const found = doc.people.find((p) => p.id === person)?.linear
  if (!found) {
    throw new Error(`${file}: ${person} has no linear account`)
  }
  return found
}
