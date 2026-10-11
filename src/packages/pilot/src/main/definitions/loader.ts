import { existsSync, lstatSync, readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { dirname, join } from 'node:path'
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

const PEOPLE_FILES = ['people.yaml', 'people.yml']

function readFailure(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code
  return code ?? (err instanceof Error ? err.message : String(err))
}

function isAutomationFile(name: string): boolean {
  return /\.ya?ml$/.test(name) && !name.startsWith('.') && !PEOPLE_FILES.includes(name)
}

type DirListing = { files: string[]; error: string | null }

function yamlFiles(dir: string): DirListing {
  try {
    const files = readdirSync(dir).filter(isAutomationFile).sort()
    return { files: files.map((f) => join(dir, f)), error: null }
  } catch (err) {
    return { files: [], error: `${dir}: couldn't list folder: ${readFailure(err)}` }
  }
}

// lstat, not existsSync: a dangling people.yaml symlink should surface as a read error.
function entryExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function peopleFilesIn(dir: string): string[] {
  return PEOPLE_FILES.map((f) => join(dir, f)).filter(entryExists)
}

function loadPeople(dirs: string[]): { people: PeopleDirectory; peopleError: string | null } {
  const found = dirs.flatMap(peopleFilesIn)
  const file = found[0]
  if (!file) {
    return { people: EMPTY_PEOPLE, peopleError: null }
  }
  if (found.length > 1) {
    console.warn(`[pilot] using ${file}; ignoring ${found.slice(1).join(', ')}`)
  }
  const conflict = peopleFilesIn(dirname(file)).length > 1
  const note = conflict ? `${file}: people.yaml and people.yml both exist; using people.yaml` : null
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    return { people: EMPTY_PEOPLE, peopleError: `${file}: couldn't read: ${readFailure(err)}` }
  }
  const parsed = parsePeopleYaml(text)
  if (parsed.ok) {
    return { people: parsed.directory, peopleError: note }
  }
  const real = `${file}: ${parsed.errors.join('; ')}`
  return { people: EMPTY_PEOPLE, peopleError: note ? `${note}. ${real}` : real }
}

// Every place an AutomationDefinition holds a PeopleRef. Add future refs
// (e.g. a reviewer) here and nowhere else.
function peopleRefs(def: AutomationDefinition): { path: string; ref: PeopleRef | undefined }[] {
  return [{ path: 'items.where.author', ref: def.items.where.author }]
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
  const listings = present.map((d) => ({ dir: d, ...yamlFiles(d) }))
  for (const l of listings) {
    if (l.error) {
      errors.push({ file: l.dir, errors: [l.error] })
    }
  }
  for (const file of listings.flatMap((l) => l.files)) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (err) {
      errors.push({ file, errors: [`${file}: couldn't read: ${readFailure(err)}`] })
      continue
    }
    const result = parseAutomationYaml(text, file)
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
  const watchers: FSWatcher[] = []
  for (const d of dirs.filter((x) => existsSync(x))) {
    try {
      const w = watch(d, fire)
      w.on('error', (err) => {
        console.warn(`[pilot] watcher for ${d} stopped: ${readFailure(err)}`)
        w.close()
      })
      watchers.push(w)
    } catch (err) {
      console.warn(`[pilot] cannot watch ${d}: ${readFailure(err)}`)
    }
  }
  return () => {
    if (timer) {
      clearTimeout(timer)
    }
    for (const w of watchers) {
      w.close()
    }
  }
}
