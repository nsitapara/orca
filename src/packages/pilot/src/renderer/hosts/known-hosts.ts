export type KnownPilotHosts = {
  get(id: string): string | null
  remember(id: string, machineName: string): void
  forget(id: string): void
}

const STORAGE_KEY = 'pilot.knownHosts.v1'

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function readAll(storage: Storage | null): Record<string, string> {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }
    const out: Record<string, string> = {}
    for (const [id, name] of Object.entries(parsed)) {
      if (typeof name === 'string') {
        out[id] = name
      }
    }
    return out
  } catch {
    return {}
  }
}

function writeAll(storage: Storage | null, value: Record<string, string>): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage can be blocked or full; the list is a convenience.
  }
}

export function localStorageKnownHosts(
  storage: Storage | null = defaultStorage()
): KnownPilotHosts {
  return {
    get: (id) => readAll(storage)[id] ?? null,
    remember(id, machineName) {
      writeAll(storage, { ...readAll(storage), [id]: machineName })
    },
    forget(id) {
      const { [id]: _removed, ...rest } = readAll(storage)
      writeAll(storage, rest)
    }
  }
}
