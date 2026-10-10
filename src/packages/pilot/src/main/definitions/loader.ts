import { existsSync, readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { AutomationDefinition, PeopleRef } from '../../shared/definition/types'
import { EMPTY_PEOPLE, parsePeopleYaml, type PeopleDirectory } from '../../shared/people'

export type LoadedDefinitions = {
  definitions: AutomationDefinition[]
  errors: { file: string; errors: string[] }[]
  people: PeopleDirectory
  peopleError: string | null
  missingDirs: string[]
}

const PEOPLE_FILE = 'people.yaml'

function yamlFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f) && f !== PEOPLE_FILE)
    .sort()
    .map((f) => join(dir, f))
}

function loadPeople(dirs: string[]): { people: PeopleDirectory; peopleError: string | null } {
  const file = dirs.map((d) => join(d, PEOPLE_FILE)).find((f) => existsSync(f))
  if (!file) {
    return { people: EMPTY_PEOPLE, peopleError: null }
  }
  const parsed = parsePeopleYaml(readFileSync(file, 'utf8'))
  if (parsed.ok) {
    return { people: parsed.directory, peopleError: null }
  }
  return { people: EMPTY_PEOPLE, peopleError: `${file}: ${parsed.errors.join('; ')}` }
}

// Every place an AutomationDefinition holds a PeopleRef. Add future refs
// (e.g. a reviewer) here and nowhere else.
function peopleRefs(def: AutomationDefinition): { path: string; ref: PeopleRef | undefined }[] {
  return [{ path: 'items.where.author', ref: def.items?.where.author }]
}

function refErrors(path: string, ref: PeopleRef | undefined, dir: PeopleDirectory): string[] {
  if (ref === undefined || ref === 'anyone') {
    return []
  }
  const people = (ref.people ?? [])
    .filter((id) => !dir.people.some((p) => p.id === id))
    .map((id) => `${path}: unknown person "${id}"`)
  const group =
    ref.group !== undefined && !dir.groups.some((g) => g.id === ref.group)
      ? [`${path}: unknown group "${ref.group}"`]
      : []
  return [...people, ...group]
}

export function unknownPeopleRefs(def: AutomationDefinition, dir: PeopleDirectory): string[] {
  return peopleRefs(def).flatMap(({ path, ref }) => refErrors(path, ref, dir))
}

export function loadDefinitions(dirs: string[]): LoadedDefinitions {
  const present = dirs.filter((d) => existsSync(d))
  const { people, peopleError } = loadPeople(present)
  const definitions: AutomationDefinition[] = []
  const errors: LoadedDefinitions['errors'] = []
  const byId = new Map<string, string>()
  for (const file of present.flatMap(yamlFiles)) {
    const result = parseAutomationYaml(readFileSync(file, 'utf8'), file)
    if (!result.ok) {
      errors.push({ file, errors: result.errors })
      continue
    }
    const earlier = byId.get(result.definition.id)
    if (earlier) {
      errors.push({
        file,
        errors: [
          `${file}: automation id "${result.definition.id}" is already defined in ${earlier}`
        ]
      })
      continue
    }
    const refProblems = unknownPeopleRefs(result.definition, people)
    if (refProblems.length > 0) {
      errors.push({ file, errors: refProblems.map((p) => `${file}: ${p}`) })
      continue
    }
    byId.set(result.definition.id, file)
    definitions.push(result.definition)
  }
  return {
    definitions,
    errors,
    people,
    peopleError,
    missingDirs: dirs.filter((d) => !existsSync(d))
  }
}

// A folder missing at startup is not watched; creating it later needs an app
// restart (or Task 21's pilot.automations.reload, which re-scans on demand).
export function watchDefinitions(
  dirs: string[],
  onChange: (loaded: LoadedDefinitions) => void,
  debounceMs = 300
): () => void {
  let timer: NodeJS.Timeout | null = null
  const fire = (): void => {
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => onChange(loadDefinitions(dirs)), debounceMs)
  }
  const watchers: FSWatcher[] = dirs.filter((d) => existsSync(d)).map((d) => watch(d, fire))
  return () => {
    if (timer) {
      clearTimeout(timer)
    }
    for (const w of watchers) {
      w.close()
    }
  }
}
