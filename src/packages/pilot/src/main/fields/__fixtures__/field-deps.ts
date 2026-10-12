import type { FieldValue } from '../../../shared/api-types'
import type { Item } from '../../sources/types'
import type { FieldCache } from '../custom-fields'
import type { FieldEngineDeps } from '../engine'

export const TEST_ENGINE_ENV = { binDir: '/pilot/bin', dataDir: '/pilot/data' }

export function testItem(over: Partial<Item> = {}): Item {
  return {
    kind: 'merge_request',
    key: 'mr:1',
    label: '!1 web-1',
    fields: {},
    worktreeHint: null,
    sortKeys: { waitingSince: null, priority: null },
    ...over
  }
}

// As the real store (A7): one row per (automation, field, item); a row stored under another cache key reads null.
export function memoryFieldCache(): FieldCache {
  const rows = new Map<string, { cacheKey: string; value: FieldValue; at: number }>()
  const key = (...parts: string[]) => parts.join('\u0000')
  return {
    get: (automationId, field, itemKey, cacheKey) => {
      const row = rows.get(key(automationId, field, itemKey))
      return row && row.cacheKey === cacheKey ? { value: row.value, at: row.at } : null
    },
    set: (automationId, field, itemKey, cacheKey, value, at) => {
      rows.set(key(automationId, field, itemKey), { cacheKey, value, at })
    }
  }
}

const NO_READING = async () => ({ weekly: null, session: null })

export function fakeFieldDeps(over: Partial<FieldEngineDeps> = {}): FieldEngineDeps {
  return {
    listWorktrees: async () => [],
    gitStatus: async () => ({ dirty: 0, untracked: 0 }),
    gitOperation: async () => null,
    automationSessions: () => [],
    anySessions: () => [],
    terminalAlive: async () => false,
    paneState: () => 'idle',
    terminalDraft: async () => '',
    quotas: { claude: NO_READING, codex: NO_READING },
    pendingAnswers: () => 0,
    cache: memoryFieldCache(),
    runScript: async () => ({ code: 0, stdout: '', stderr: '', timedOut: false }),
    engineEnv: TEST_ENGINE_ENV,
    now: () => 1,
    ...over
  }
}
