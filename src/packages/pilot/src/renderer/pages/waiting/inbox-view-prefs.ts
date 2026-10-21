import { useSyncExternalStore } from 'react'

export type InboxGroupBy = 'worktree' | 'job' | 'kind' | 'age' | 'none'
export type InboxSort = 'kind' | 'oldest' | 'newest'
export type InboxView = 'cards' | 'rows' | 'focus'
export type InboxViewPrefs = {
  group: InboxGroupBy
  sort: InboxSort
  view: InboxView
}

export const INBOX_VIEW_PREFS_KEY = 'pilot.inbox.view'

const GROUPS: readonly InboxGroupBy[] = ['worktree', 'job', 'kind', 'age', 'none']
const SORTS: readonly InboxSort[] = ['kind', 'oldest', 'newest']
const VIEWS: readonly InboxView[] = ['cards', 'rows', 'focus']

const DEFAULTS: InboxViewPrefs = {
  group: 'worktree',
  sort: 'kind',
  view: 'cards'
}

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.find((option) => option === value) ?? fallback
}

function load(): InboxViewPrefs {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(INBOX_VIEW_PREFS_KEY) ?? '{}')
    const saved = typeof parsed === 'object' && parsed !== null ? parsed : {}
    return {
      group: pick(GROUPS, 'group' in saved ? saved.group : undefined, DEFAULTS.group),
      sort: pick(SORTS, 'sort' in saved ? saved.sort : undefined, DEFAULTS.sort),
      view: pick(VIEWS, 'view' in saved ? saved.view : undefined, DEFAULTS.view)
    }
  } catch {
    // Blocked storage or corrupt JSON: start from the defaults.
    return DEFAULTS
  }
}

let cache: InboxViewPrefs | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function getInboxViewPrefs(): InboxViewPrefs {
  cache ??= load()
  return cache
}

export function setInboxViewPrefs(patch: Partial<InboxViewPrefs>): void {
  cache = { ...getInboxViewPrefs(), ...patch }
  try {
    window.localStorage.setItem(INBOX_VIEW_PREFS_KEY, JSON.stringify(cache))
  } catch {
    // Blocked storage: the choice holds for this session only.
  }
  notify()
}

// Forget the in-memory copy so the next read goes to storage again (tests).
export function resetInboxViewPrefs(): void {
  cache = null
  notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useInboxViewPrefs(): [InboxViewPrefs, (patch: Partial<InboxViewPrefs>) => void] {
  return [useSyncExternalStore(subscribe, getInboxViewPrefs), setInboxViewPrefs]
}
