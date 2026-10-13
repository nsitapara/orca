import {
  loadDefinitions,
  watchDefinitions,
  type DefinitionMemory,
  type LoadedDefinitions
} from './loader'

export type LiveDefinitions = {
  current(): LoadedDefinitions
  reload(): LoadedDefinitions
  stop(): void
}

export type DefinitionIo = {
  load(dirs: string[]): LoadedDefinitions
  watch(dirs: string[], onChange: (loaded: LoadedDefinitions) => void): () => void
}

// The real folder IO. With a memory, an invalid edit keeps the automation's last valid version.
export function definitionIo(
  memory: DefinitionMemory | null,
  now: () => number = Date.now
): DefinitionIo {
  const load = (dirs: string[]): LoadedDefinitions => loadDefinitions(dirs, memory, now)
  return { load, watch: (dirs, onChange) => watchDefinitions(dirs, onChange, 300, load) }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// peopleError can be a notice (people.yaml and people.yml both present) as well as a failure; either
// way the automations still load, so it is reported, never treated as fatal.
function report(loaded: LoadedDefinitions, log: (message: string) => void): void {
  if (loaded.peopleError) {
    log(`[pilot] people: ${loaded.peopleError}`)
  }
  for (const file of [
    ...loaded.errors.map((e) => e.errors),
    ...(loaded.warnings ?? []).map((w) => w.warnings)
  ]) {
    for (const line of file) {
      log(`[pilot] ${line}`)
    }
  }
}

// The automation folders as last loaded. The watcher may fire with unchanged content, so a reload
// equal to the current one changes nothing (the scheduler's cached next ticks stay valid).
export function liveDefinitions(
  dirs: string[],
  log: (message: string) => void,
  io: DefinitionIo = definitionIo(null)
): LiveDefinitions {
  let loaded = io.load(dirs)
  let fingerprint = JSON.stringify(loaded)
  report(loaded, log)
  const apply = (next: LoadedDefinitions): LoadedDefinitions => {
    const nextFingerprint = JSON.stringify(next)
    if (nextFingerprint === fingerprint) {
      return loaded
    }
    log(`[pilot] automations reloaded: ${next.definitions.length} automation(s)`)
    report(next, log)
    loaded = next
    fingerprint = nextFingerprint
    return loaded
  }
  // Why the catch: this runs from the watcher's timer, where a throw would be an uncaught exception.
  const stopWatching = io.watch(dirs, (next) => {
    try {
      apply(next)
    } catch (error) {
      log(`[pilot] couldn't apply reloaded automations: ${messageOf(error)}`)
    }
  })
  let stopped = false
  return {
    current: () => loaded,
    reload: () => apply(io.load(dirs)),
    stop: () => {
      if (!stopped) {
        stopped = true
        stopWatching()
      }
    }
  }
}
