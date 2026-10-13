import { existsSync, lstatSync, readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { dirname, join } from 'node:path'
import { jobProblems } from '../../shared/definition/jobs'
import { idFromFile } from '../../shared/definition/normalize'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { AutomationDefinition, PeopleRef } from '../../shared/definition/types'
import { PEOPLE_REF_CLAUSES } from '../../shared/definition/where'
import { EMPTY_PEOPLE, parsePeopleYaml, type PeopleDirectory } from '../../shared/people'
import type { DefinitionStore } from '../store/store-definitions'

export type LoadedDefinitions = {
  definitions: AutomationDefinition[]
  errors: { file: string; errors: string[] }[]
  people: PeopleDirectory
  peopleError: string | null
  missingDirs: string[]
  // Ids whose file turned invalid: shown from their last valid version, never ticked (fail closed).
  displayOnly?: string[]
}

// Where the loader keeps each automation's last valid version: the store's definitions tables.
export type DefinitionMemory = Pick<
  DefinitionStore,
  'lastValid' | 'saveValid' | 'saveErrors' | 'forgetAllBut'
>

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

// Every where clause that names people (PEOPLE_REF_CLAUSES in where.ts); approved_by may be 'none'.
function peopleRefs(def: AutomationDefinition): { path: string; ref: PeopleRef }[] {
  const where = def.items?.where ?? {}
  return PEOPLE_REF_CLAUSES.flatMap((clause) => {
    const ref = where[clause]
    if (ref === undefined || ref === 'none') {
      return []
    }
    return [{ path: `items.where.${clause}`, ref: ref as PeopleRef }]
  })
}

function refErrors(path: string, ref: PeopleRef | undefined, dir: PeopleDirectory): string[] {
  if (ref === undefined || ref === 'anyone') {
    return []
  }
  if ('not' in ref) {
    return refErrors(`${path}.not`, ref.not, dir)
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

type FileResult =
  | { ok: true; definition: AutomationDefinition; yaml: string }
  // `fallback`: whether this file's last valid version may stand in. Never for a duplicate id,
  // which belongs to the other file.
  | { ok: false; errors: string[]; fallback: boolean }

function loadFile(file: string, people: PeopleDirectory, byId: Map<string, string>): FileResult {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    return { ok: false, errors: [`${file}: couldn't read: ${readFailure(err)}`], fallback: true }
  }
  const result = parseAutomationYaml(text, file)
  if (!result.ok) {
    return { ok: false, errors: result.errors, fallback: true }
  }
  const earlier = byId.get(result.definition.id)
  if (earlier) {
    return {
      ok: false,
      errors: [`${file}: automation id "${result.definition.id}" is already defined in ${earlier}`],
      fallback: false
    }
  }
  const refProblems = unknownPeopleRefs(result.definition, people)
  if (refProblems.length > 0) {
    return { ok: false, errors: refProblems.map((p) => `${file}: ${p}`), fallback: true }
  }
  return { ok: true, definition: result.definition, yaml: text }
}

// The memory only helps: when it fails, loading carries on without it (fail soft).
function remember<T>(what: string, fallback: T, act: () => T): T {
  try {
    return act()
  } catch (err) {
    console.warn(`[pilot] couldn't ${what}: ${readFailure(err)}`)
    return fallback
  }
}

// Records why the file failed, then returns the saved version of this same file that keeps running,
// if today's parser and people.yaml still accept it.
function keptVersion(
  memory: DefinitionMemory,
  file: string,
  errors: string[],
  people: PeopleDirectory,
  at: number
): { definition: AutomationDefinition; note: string } | null {
  const id = idFromFile(file)
  remember('save the errors', undefined, () => memory.saveErrors(id, file, errors, at))
  const saved = remember('read the last valid version', null, () => memory.lastValid(id))
  if (!saved || saved.file !== file) {
    return null
  }
  const parsed = parseAutomationYaml(saved.yaml, file)
  if (!parsed.ok || unknownPeopleRefs(parsed.definition, people).length > 0) {
    return null
  }
  const when = new Date(saved.loadedAt).toISOString()
  return {
    definition: parsed.definition,
    note: `${file}: Pilot shows the last valid version, saved ${when}; it isn't ticked until the file is valid again`
  }
}

// With a memory, a file that turns invalid keeps its last valid version for display (a running run's
// steps still read it) but is never ticked (displayOnly), and its error entry says so; a deleted file is
// forgotten (contract §9, `definitions`).
export function loadDefinitions(
  dirs: string[],
  memory: DefinitionMemory | null = null,
  now: () => number = Date.now
): LoadedDefinitions {
  const present = dirs.filter((d) => existsSync(d))
  const { people, peopleError } = loadPeople(present)
  const definitions: AutomationDefinition[] = []
  const errors: LoadedDefinitions['errors'] = []
  const byId = new Map<string, string>()
  const displayOnly: string[] = []
  const listings = present.map((d) => ({ dir: d, ...yamlFiles(d) }))
  for (const l of listings) {
    if (l.error) {
      errors.push({ file: l.dir, errors: [l.error] })
    }
  }
  const files = listings.flatMap((l) => l.files)
  // Saved as the last valid version only once the job rules across files accept them.
  const fresh: { file: string; definition: AutomationDefinition; yaml: string }[] = []
  for (const file of files) {
    const id = idFromFile(file)
    const result = loadFile(file, people, byId)
    if (result.ok) {
      byId.set(id, file)
      definitions.push(result.definition)
      fresh.push({ file, definition: result.definition, yaml: result.yaml })
      continue
    }
    // A duplicate id never falls back; neither does an id another file already loaded.
    const kept =
      memory !== null && result.fallback && !byId.has(id)
        ? keptVersion(memory, file, result.errors, people, now())
        : null
    if (kept) {
      byId.set(id, file)
      definitions.push(kept.definition)
      displayOnly.push(kept.definition.id)
    }
    errors.push({ file, errors: kept ? [...result.errors, kept.note] : result.errors })
  }
  // A job rule broken across files makes every definition it involves invalid, like a broken file.
  const problems = jobProblems(definitions)
  for (const { file, definition, yaml } of fresh) {
    const own = problems.get(definition.id)
    if (!own) {
      if (memory) {
        remember('save the valid version', undefined, () =>
          memory.saveValid(definition, yaml, now())
        )
      }
      continue
    }
    const refused = own.map((p) => `${file}: ${p}`)
    const kept = memory ? keptVersion(memory, file, refused, people, now()) : null
    const at = definitions.indexOf(definition)
    if (kept) {
      definitions.splice(at, 1, kept.definition)
      displayOnly.push(kept.definition.id)
    } else {
      definitions.splice(at, 1)
    }
    errors.push({ file, errors: kept ? [...refused, kept.note] : refused })
  }
  // Only a complete listing can say which files are gone.
  if (memory && present.length === dirs.length && listings.every((l) => !l.error)) {
    const ids = files.map(idFromFile)
    remember('forget removed automations', undefined, () => memory.forgetAllBut(ids))
  }
  return {
    definitions,
    errors,
    people,
    peopleError,
    missingDirs: dirs.filter((d) => !existsSync(d)),
    displayOnly
  }
}

// A folder missing at startup is not watched; creating it later needs an app
// restart (or pilot.automations.reload, which re-scans on demand).
export function watchDefinitions(
  dirs: string[],
  onChange: (loaded: LoadedDefinitions) => void,
  debounceMs = 300,
  load: (dirs: string[]) => LoadedDefinitions = loadDefinitions
): () => void {
  let timer: NodeJS.Timeout | null = null
  const fire = (): void => {
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => onChange(load(dirs)), debounceMs)
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
