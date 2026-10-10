import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import type { PeopleRef } from './definition/types'

const ACCOUNT_FIELDS = ['gitlab', 'github', 'linear', 'slack'] as const

const personSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  gitlab: z.string().optional(),
  github: z.string().optional(),
  linear: z.string().optional(),
  slack: z.string().optional()
})
const groupSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  members: z.array(z.string())
})
const directorySchema = z.strictObject({
  people: z.array(personSchema),
  groups: z.array(groupSchema).optional()
})

export type Person = z.infer<typeof personSchema>
export type PeopleDirectory = { people: Person[]; groups: z.infer<typeof groupSchema>[] }
export const EMPTY_PEOPLE: PeopleDirectory = { people: [], groups: [] }

function readYaml(text: string): { ok: true; value: unknown } | { ok: false; errors: string[] } {
  try {
    return { ok: true, value: parseYaml(text) }
  } catch (err) {
    return {
      ok: false,
      errors: [`invalid YAML: ${err instanceof Error ? err.message : String(err)}`]
    }
  }
}

function duplicateIdErrors(people: Person[]): string[] {
  const ids = people.map((p) => p.id)
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
  return dupes.length ? [`duplicate person id: ${dupes.join(', ')}`] : []
}

function accountErrors(people: Person[]): string[] {
  const owners = new Map<string, string>()
  const errors: string[] = []
  for (const person of people) {
    for (const field of ACCOUNT_FIELDS) {
      const value = person[field]
      if (value === undefined) {
        continue
      }
      const key = `${field}:${value.toLowerCase()}`
      const owner = owners.get(key)
      if (owner === undefined) {
        owners.set(key, person.id)
      } else {
        errors.push(`people.${person.id}.${field}: "${value}" is also used by ${owner}`)
      }
    }
  }
  return errors
}

function memberErrors(people: Person[], groups: z.infer<typeof groupSchema>[]): string[] {
  const personIds = new Set(people.map((p) => p.id))
  return groups.flatMap((g) =>
    g.members.filter((m) => !personIds.has(m)).map((m) => `groups.${g.id}: unknown member "${m}"`)
  )
}

export function parsePeopleYaml(
  text: string
): { ok: true; directory: PeopleDirectory } | { ok: false; errors: string[] } {
  const raw = readYaml(text)
  if (!raw.ok) {
    return raw
  }
  const parsed = directorySchema.safeParse(raw.value)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    }
  }
  const { people, groups = [] } = parsed.data
  const errors = [
    ...duplicateIdErrors(people),
    ...accountErrors(people),
    ...memberErrors(people, groups)
  ]
  if (errors.length) {
    return { ok: false, errors }
  }
  return { ok: true, directory: { people, groups } }
}

export function personByGitlab(dir: PeopleDirectory, username: string): Person | null {
  const wanted = username.toLowerCase()
  return dir.people.find((p) => p.gitlab?.toLowerCase() === wanted) ?? null
}

export function refIncludes(
  ref: PeopleRef | undefined,
  personId: string,
  dir: PeopleDirectory
): boolean {
  if (ref === undefined || ref === 'anyone') {
    return true
  }
  if (ref.people?.includes(personId)) {
    return true
  }
  if (!ref.group) {
    return false
  }
  return dir.groups.find((g) => g.id === ref.group)?.members.includes(personId) ?? false
}

function nameOf(id: string, dir: PeopleDirectory): string {
  return dir.people.find((p) => p.id === id)?.name ?? id
}

function joinNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? 'nobody'
  }
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

export function describeRef(ref: PeopleRef | undefined, dir: PeopleDirectory): string {
  if (ref === undefined || ref === 'anyone') {
    return 'anyone'
  }
  const names = (ref.people ?? []).map((id) => nameOf(id, dir))
  if (ref.group) {
    names.push(dir.groups.find((g) => g.id === ref.group)?.name ?? ref.group)
  }
  return joinNames(names)
}
