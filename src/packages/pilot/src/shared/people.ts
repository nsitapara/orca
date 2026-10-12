import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import type { PeopleRef, PeopleSet } from './definition/types'

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

function setIncludes(set: PeopleSet, personId: string, dir: PeopleDirectory): boolean {
  if (set.people?.includes(personId)) {
    return true
  }
  if (!set.group) {
    return false
  }
  return dir.groups.find((g) => g.id === set.group)?.members.includes(personId) ?? false
}

export function refIncludes(
  ref: PeopleRef | undefined,
  personId: string,
  dir: PeopleDirectory
): boolean {
  if (ref === undefined || ref === 'anyone') {
    return true
  }
  if ('not' in ref) {
    return !setIncludes(ref.not, personId, dir)
  }
  return setIncludes(ref, personId, dir)
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

function describeSet(set: PeopleSet, dir: PeopleDirectory): string {
  const names = (set.people ?? []).map((id) => nameOf(id, dir))
  if (set.group) {
    names.push(dir.groups.find((g) => g.id === set.group)?.name ?? set.group)
  }
  return joinNames(names)
}

export function describeRef(ref: PeopleRef | undefined, dir: PeopleDirectory): string {
  if (ref === undefined || ref === 'anyone') {
    return 'anyone'
  }
  if ('not' in ref) {
    return `anyone but ${describeSet(ref.not, dir)}`
  }
  return describeSet(ref, dir)
}

// The GitLab handles a ref names, so a list request can ask for just those authors. null means no
// author filter (anyone/absent, or a `not` ref, which is filtered after listing). People without a
// gitlab handle can't author MRs and are skipped, so an empty list means "nobody resolvable", never
// "everyone".
export function gitlabHandlesFor(
  ref: PeopleRef | undefined,
  dir: PeopleDirectory
): string[] | null {
  if (ref === undefined || ref === 'anyone' || 'not' in ref) {
    return null
  }
  const ids = new Set(ref.people ?? [])
  if (ref.group) {
    for (const id of dir.groups.find((g) => g.id === ref.group)?.members ?? []) {
      ids.add(id)
    }
  }
  const handles = dir.people.filter((p) => ids.has(p.id)).map((p) => p.gitlab)
  return [...new Set(handles.filter((h): h is string => h !== undefined && h !== ''))]
}

export type Account = (typeof ACCOUNT_FIELDS)[number]

export function personByAccount(
  dir: PeopleDirectory,
  account: Account,
  handle: string
): Person | null {
  if (handle === '') {
    return null
  }
  const wanted = handle.toLowerCase()
  return dir.people.find((p) => p[account]?.toLowerCase() === wanted) ?? null
}

export function personByGithub(dir: PeopleDirectory, login: string): Person | null {
  return personByAccount(dir, 'github', login)
}

// people.yaml's `linear` is the person's Linear display name (or their Linear user id).
export function personByLinear(dir: PeopleDirectory, name: string): Person | null {
  return personByAccount(dir, 'linear', name)
}

export type RefMatch = { ok: true } | { ok: false; reason: string }
const MATCH: RefMatch = { ok: true }

// Whether the account <handle> (an MR's author, a ticket's assignee) is someone <ref> names. The
// reasons keep M1's wording ("Author nish8 isn't in people.yaml"); a not-ref passes anyone people.yaml
// doesn't know, since they can't be one of the people it leaves out.
export function matchRef(
  ref: PeopleRef | undefined,
  role: string,
  account: Account,
  handle: string | null,
  dir: PeopleDirectory
): RefMatch {
  if (ref === undefined || ref === 'anyone') {
    return MATCH
  }
  const person = handle ? personByAccount(dir, account, handle) : null
  if ('not' in ref) {
    if (person && !refIncludes(ref, person.id, dir)) {
      return {
        ok: false,
        reason: `${role} is ${person.name}; this automation leaves out ${describeRef(ref.not, dir)}`
      }
    }
    return MATCH
  }
  if (!handle) {
    return { ok: false, reason: `${role} is unknown` }
  }
  if (!person) {
    return { ok: false, reason: `${role} ${handle} isn't in people.yaml` }
  }
  if (refIncludes(ref, person.id, dir)) {
    return MATCH
  }
  return {
    ok: false,
    reason: `${role} is ${person.name}; this automation looks at ${describeRef(ref, dir)}`
  }
}

// The same for a list of accounts (an MR's reviewers or approvers): a set needs one of them in it,
// a not-ref none of them.
export function matchRefAny(
  ref: PeopleRef | undefined,
  role: string,
  account: Account,
  handles: readonly string[],
  dir: PeopleDirectory
): RefMatch {
  if (ref === undefined || ref === 'anyone') {
    return MATCH
  }
  const people = handles
    .map((h) => personByAccount(dir, account, h))
    .filter((p): p is Person => p !== null)
  if ('not' in ref) {
    const hit = people.find((p) => !refIncludes(ref, p.id, dir))
    if (hit) {
      return {
        ok: false,
        reason: `${role}: ${hit.name}; this automation leaves out ${describeRef(ref.not, dir)}`
      }
    }
    return MATCH
  }
  if (people.some((p) => refIncludes(ref, p.id, dir))) {
    return MATCH
  }
  const who = handles.length > 0 ? handles.join(', ') : 'nobody'
  return { ok: false, reason: `${role}: ${who}; this automation looks at ${describeRef(ref, dir)}` }
}
