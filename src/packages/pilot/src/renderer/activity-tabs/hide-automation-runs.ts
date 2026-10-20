import { useEffect, useSyncExternalStore } from 'react'
import { getWorktreeExecutionHostId } from '../../../../../shared/execution-host'
import type { Repo } from '../../../../../shared/repo-types'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type { Worktree } from '../../../../../shared/worktree/types'
import type {
  ActivityThreadGroup,
  AgentPaneThread
} from '@/components/activity/activity-thread-types'
import { ipcOrRuntimeTargetForHostId } from '@/runtime/runtime-client-target'
import { pilotRpc } from '../api'
import type { WorkspaceTabItem } from './workspace-tab-items'

// A tab, and the Pilot that would have run a step in it: its worktree's host.
export type HostedTab = { tabId: string; target: RuntimeClientTarget }

// A step records its pane just after its tab opens, so a tab's "no" is asked again for a minute.
const SETTLE_MS = 60_000
const ASK_EVERY_MS = 5_000

type Answer = { automation: boolean; firstAskedAt: number }
const answers = new Map<string, Answer>()
let found: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()
let asking = false
const NONE: ReadonlySet<string> = new Set()

function hostedTab(tabId: string, worktree: Worktree, repo: Repo | null): HostedTab | null {
  const target = ipcOrRuntimeTargetForHostId(
    getWorktreeExecutionHostId(worktree, repo ?? undefined)
  )
  return target ? { tabId, target } : null
}

export function hostedTabsOf(
  threads: readonly AgentPaneThread[],
  tabs: readonly WorkspaceTabItem[]
): HostedTab[] {
  return [
    ...threads.map((t) => hostedTab(t.tab.id, t.worktree, t.repo)),
    ...tabs
      .filter((item) => item.tab.contentType === 'terminal')
      .map((item) => hostedTab(item.tab.entityId, item.worktree, item.repo))
  ].filter((t) => t !== null)
}

function targetKey(target: RuntimeClientTarget): string {
  return target.kind === 'environment' ? target.environmentId : ''
}

type HostAsk = { target: RuntimeClientTarget; tabIds: string[] }

function toAsk(tabs: readonly HostedTab[], now: number): HostAsk[] {
  const byHost = new Map<string, HostAsk>()
  for (const { tabId, target } of tabs) {
    const answer = answers.get(tabId)
    if (answer && (answer.automation || now - answer.firstAskedAt > SETTLE_MS)) {
      continue
    }
    const ask = byHost.get(targetKey(target)) ?? { target, tabIds: [] }
    ask.tabIds.push(tabId)
    byHost.set(targetKey(target), ask)
  }
  return [...byHost.values()]
}

// Each tab's own Pilot answers; one that refuses (unreachable, or too old to know the method) leaves its rows shown.
export async function askAutomationTabs(tabs: readonly HostedTab[], now: number): Promise<void> {
  if (asking) {
    return
  }
  asking = true
  try {
    await Promise.all(
      toAsk(tabs, now).map(async ({ target, tabIds }) => {
        const yes = await pilotRpc<{ tabIds: string[] }>(
          'pilot.runs.automationTabs',
          { tabIds },
          { target }
        ).then(
          (r) => new Set(r.tabIds),
          () => new Set<string>()
        )
        for (const id of tabIds) {
          const firstAskedAt = answers.get(id)?.firstAskedAt ?? now
          answers.set(id, { automation: yes.has(id), firstAskedAt })
        }
        if (yes.size > 0) {
          found = new Set([...found, ...yes])
          listeners.forEach((listener) => listener())
        }
      })
    )
  } finally {
    asking = false
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Tab ids and host ids hold no tab or newline, so one string stands for the list across renders.
function keyOf(tabs: readonly HostedTab[]): string {
  return tabs.map((t) => `${targetKey(t.target)}\t${t.tabId}`).join('\n')
}

function tabsOf(key: string): HostedTab[] {
  return key.split('\n').map((line) => {
    const [environmentId = '', tabId = ''] = line.split('\t')
    const target: RuntimeClientTarget = environmentId
      ? { kind: 'environment', environmentId }
      : { kind: 'local' }
    return { tabId, target }
  })
}

// The tabs among these a Pilot step ran in, while `enabled`.
export function useAutomationTabIds(
  tabs: readonly HostedTab[],
  enabled: boolean
): ReadonlySet<string> {
  const ids = useSyncExternalStore(
    subscribe,
    () => found,
    () => NONE
  )
  const key = keyOf(tabs)
  useEffect(() => {
    if (!enabled || key === '') {
      return
    }
    const ask = (): void => void askAutomationTabs(tabsOf(key), Date.now())
    ask()
    const timer = window.setInterval(ask, ASK_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [enabled, key])
  return enabled ? ids : NONE
}

// Groups less the threads in automation tabs; a group left with none goes.
export function withoutAutomationThreads(
  groups: ActivityThreadGroup[],
  automationTabs: ReadonlySet<string>
): ActivityThreadGroup[] {
  if (automationTabs.size === 0) {
    return groups
  }
  return groups
    .map((group) => ({
      ...group,
      threads: group.threads.filter((t) => !automationTabs.has(t.tab.id))
    }))
    .filter((group) => group.threads.length > 0)
}

export function withoutAutomationTabs(
  tabs: readonly WorkspaceTabItem[],
  automationTabs: ReadonlySet<string>
): readonly WorkspaceTabItem[] {
  if (automationTabs.size === 0) {
    return tabs
  }
  return tabs.filter((item) => !automationTabs.has(item.tab.entityId))
}

export function resetAutomationTabsForTests(): void {
  answers.clear()
  found = new Set()
  asking = false
}
