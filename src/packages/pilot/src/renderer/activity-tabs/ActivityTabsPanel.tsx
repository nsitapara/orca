import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../../shared/constants'
import type { Tab, TabGroup } from '../../../../../shared/tab-types'
import { useClientHostedBrowserRows } from '@/lib/pane-manager/client-hosted-browser-row-state'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { pilotStore } from '../store'
import { useActivityShowAllTabs } from './activity-tabs-setting'
import { useWorktreeTabsContext } from './use-worktree-tabs-context'
import { buildWorktreeTabItems, type WorktreeTabsContext } from './workspace-tab-items'
import { WorkspaceActions } from './WorkspaceActions'
import { WorkspaceTabRow } from './WorkspaceTabRow'

const NO_TABS: readonly Tab[] = []
const NO_GROUPS: readonly TabGroup[] = []

// Same look as Activity's ActivityStatusGroupHeader, which takes a whole thread group.
function GroupHeader({
  label,
  count,
  collapsed,
  onToggle
}: {
  label: string
  count?: number
  collapsed: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      onClick={onToggle}
      className="group flex h-7 w-full cursor-pointer select-none items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
    >
      <ChevronDown
        className={cn(
          'size-3 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:text-foreground',
          collapsed && '-rotate-90'
        )}
      />
      <span className="min-w-0 flex-1 truncate text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-foreground/80 transition-colors group-hover:text-foreground">
        {label}
      </span>
      {count === undefined ? null : (
        <span className="rounded-full border border-border/80 bg-muted/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums leading-none text-foreground/80 shadow-xs">
          {count}
        </span>
      )}
    </button>
  )
}

function WorktreeTabs({
  worktreeId,
  ctx
}: {
  worktreeId: string
  ctx: WorktreeTabsContext
}): React.JSX.Element | null {
  const tabs = useAppStore((s) => s.unifiedTabsByWorktree[worktreeId] ?? NO_TABS)
  const groups = useAppStore((s) => s.groupsByWorktree[worktreeId] ?? NO_GROUPS)
  const clientRows = useClientHostedBrowserRows(worktreeId)
  const [collapsed, setCollapsed] = useState(false)
  const items = useMemo(
    () => buildWorktreeTabItems(worktreeId, { tabs, groups, clientRows }, ctx),
    [worktreeId, tabs, groups, clientRows, ctx]
  )
  if (items.length === 0) {
    return null
  }
  return (
    <div data-activity-tabs-worktree={worktreeId}>
      <GroupHeader
        label={items[0].worktree.displayName}
        count={items.length}
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
      />
      {collapsed ? null : items.map((item) => <WorkspaceTabRow key={item.key} item={item} />)}
    </div>
  )
}

function compareWorktrees(activeId: string | null, nameOf: (id: string) => string) {
  return (a: string, b: string): number => {
    if (a === activeId || b === activeId) {
      return a === activeId ? -1 : 1
    }
    return nameOf(a).localeCompare(nameOf(b))
  }
}

function OpenTabs({ query }: { query: string }): React.JSX.Element {
  const ctx = useWorktreeTabsContext(query)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const worktreeIds = useAppStore(
    useShallow((s) =>
      Object.keys(s.groupsByWorktree).filter((id) => id !== FLOATING_TERMINAL_WORKTREE_ID)
    )
  )
  const [collapsed, setCollapsed] = useState(false)
  const ordered = useMemo(() => {
    const nameOf = (id: string) => ctx.getKnownWorktreeById(id)?.displayName ?? id
    return [...worktreeIds].sort(compareWorktrees(activeWorktreeId, nameOf))
  }, [worktreeIds, activeWorktreeId, ctx])
  return (
    <div className="flex min-h-0 flex-col px-1 py-1">
      <GroupHeader
        label="Open tabs"
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
      />
      {collapsed ? null : (
        <div className="min-h-0 overflow-y-auto pl-2">
          {ordered.map((id) => (
            <WorktreeTabs key={id} worktreeId={id} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
  )
}

// pilot-hook: activity-tabs-panel. Sits above the agent list while "Show all tabs" is on.
export function ActivityTabsPanel({ query }: { query: string }): React.JSX.Element | null {
  const on = useActivityShowAllTabs()
  if (!on || !pilotStore()) {
    return null
  }
  return (
    <div className="flex max-h-[50%] min-h-0 shrink-0 flex-col border-b border-border">
      <WorkspaceActions />
      <OpenTabs query={query} />
    </div>
  )
}
