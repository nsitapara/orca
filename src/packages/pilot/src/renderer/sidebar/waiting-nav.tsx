import { useCallback, useSyncExternalStore } from 'react'
import { FlaskConical, Gauge, Inbox, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { InboxListPayload } from '../../shared/inbox-types'
import { useHostPoll } from '../hosts/host-poll'
import { waitingTotal } from '../hosts/merge-inbox'
import {
  setPilotAutomationsView,
  setPilotOpenAutomation,
  usePilotAutomationsView,
  type PilotAutomationsView
} from '../pages/automations-view'
import { useCapacityTotals } from '../pages/running/use-capacity'
import { pilotStore } from '../store'

const WAITING_TOTAL_MS = 20_000

// The count on the sidebar item: every machine's open cards, whoever they are for (one person uses Pilot today).
export function useWaitingTotal(): number {
  const { reads } = useHostPoll<InboxListPayload>('pilot.inbox.list', {}, WAITING_TOTAL_MS)
  // A machine whose last read failed counts nothing, as before: the pill never shows a stale count.
  return waitingTotal(reads.filter((r) => r.error === null))
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

const PILL_TONES = {
  // Cards that need Nish.
  attention: 'bg-primary text-primary-foreground',
  quiet: 'bg-worktree-sidebar-foreground/10 text-worktree-sidebar-foreground/70',
  waiting: 'bg-status-warning-background text-status-warning'
} as const

type NavPill = { count: number; tone: keyof typeof PILL_TONES; title?: string }

// A sidebar item under Automations that opens one of its views. A pill whose count is 0 is not shown.
function ViewNavButton({
  view: target,
  icon: Icon,
  label,
  pills
}: {
  view: PilotAutomationsView
  icon: LucideIcon
  label: string
  pills?: NavPill[]
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
      {pills
        ?.filter((pill) => pill.count > 0)
        .map((pill) => (
          <span
            key={pill.tone}
            title={pill.title}
            className={cn(
              'shrink-0 rounded-full px-1.5 py-px text-3xs font-semibold tabular-nums',
              PILL_TONES[pill.tone]
            )}
          >
            {pill.count}
          </span>
        ))}
    </button>
  )
}

function WaitingNavButton(): React.JSX.Element {
  const pills: NavPill[] = [{ count: useWaitingTotal(), tone: 'attention' }]
  return <ViewNavButton view="inbox" icon={Inbox} label="Inbox" pills={pills} />
}

// The Running page's own counts: runs going now, and in yellow the ones waiting for a slot.
function RunningNavButton(): React.JSX.Element {
  const { running, queued } = useCapacityTotals()
  const pills: NavPill[] = [
    {
      count: running,
      tone: 'quiet',
      title: 'Running now'
    },
    {
      count: queued,
      tone: 'waiting',
      title: 'Waiting for a slot'
    }
  ]
  return <ViewNavButton view="running" icon={Gauge} label="Running" pills={pills} />
}

export function WaitingNavItem(): React.JSX.Element | null {
  const store = pilotStore()
  if (!store || store.getState().settings?.showAutomationsButton === false) {
    return null
  }
  return (
    <>
      <WaitingNavButton />
      <RunningNavButton />
      <ViewNavButton view="playground" icon={FlaskConical} label="Playground" />
    </>
  )
}
