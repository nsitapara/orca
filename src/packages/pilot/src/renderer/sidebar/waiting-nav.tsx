import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { FlaskConical, Gauge, Inbox, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { InboxListPayload } from '../../shared/inbox-types'
import { pilotRpc } from '../api'
import {
  setPilotAutomationsView,
  setPilotOpenAutomation,
  usePilotAutomationsView,
  type PilotAutomationsView
} from '../pages/automations-view'
import { waitingCount } from '../pages/waiting/answer-text'
import { pilotStore } from '../store'

// The count on the sidebar item: every open card, whoever it is for (one person uses Pilot today).
export function useWaitingTotal(): number {
  const [total, setTotal] = useState(0)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      pilotRpc<InboxListPayload>('pilot.inbox.list', {}).then(
        (p) => alive && setTotal(waitingCount(p.items)),
        () => alive && setTotal(0)
      )
    }
    load()
    const timer = setInterval(load, 20_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return total
}

// Automations is not highlighted while a view with its own sidebar item shows.
export function useAutomationsActive(pageOpen: boolean): boolean {
  const view = usePilotAutomationsView()
  return pageOpen && view !== 'inbox' && view !== 'running' && view !== 'playground'
}

// Clicking Automations leaves the Inbox view, and always lands on the list: an automation that was
// open is closed even when the view was already Automations.
export function useOpenAutomations(open: () => void): () => void {
  return useCallback(() => {
    setPilotAutomationsView('automations')
    setPilotOpenAutomation(null)
    open()
  }, [open])
}

// Upstream's one-line hook: the store selector lives here.
export function useOpenAutomationsPage(
  useStore: (selector: (s: { openAutomationsPage: () => void }) => () => void) => () => void
): () => void {
  return useOpenAutomations(useStore((s) => s.openAutomationsPage))
}

function useActiveView(): string | undefined {
  const store = pilotStore()
  const subscribe = useCallback(
    (listener: () => void) => store?.subscribe?.(listener) ?? (() => {}),
    [store]
  )
  return useSyncExternalStore(subscribe, () => store?.getState().activeView)
}

// A sidebar item under Automations that opens one of its views.
function ViewNavButton({
  view: target,
  icon: Icon,
  label,
  count = 0
}: {
  view: PilotAutomationsView
  icon: LucideIcon
  label: string
  count?: number
}): React.JSX.Element {
  const view = usePilotAutomationsView()
  const activeView = useActiveView()
  const active = activeView === 'automations' && view === target
  const open = (): void => {
    setPilotAutomationsView(target)
    pilotStore()?.getState().openAutomationsPage?.()
  }
  return (
    <button
      type="button"
      onClick={open}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
        active
          ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
          : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
      )}
    >
      <Icon
        className={cn('size-4 shrink-0', !active && 'text-worktree-sidebar-foreground/30')}
        strokeWidth={active ? 2.25 : 1.75}
      />
      <span className="flex-1">{label}</span>
      {count > 0 ? (
        <span className="shrink-0 rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground">
          {count}
        </span>
      ) : null}
    </button>
  )
}

function WaitingNavButton(): React.JSX.Element {
  return <ViewNavButton view="inbox" icon={Inbox} label="Inbox" count={useWaitingTotal()} />
}

export function WaitingNavItem(): React.JSX.Element | null {
  const store = pilotStore()
  if (!store || store.getState().settings?.showAutomationsButton === false) {
    return null
  }
  return (
    <>
      <WaitingNavButton />
      <ViewNavButton view="running" icon={Gauge} label="Running" />
      <ViewNavButton view="playground" icon={FlaskConical} label="Playground" />
    </>
  )
}
