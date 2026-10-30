import { PinOff } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import type { InboxListPayload } from '../../shared/inbox-types'
import { sidebarNavPages, type SidebarPageKey } from '../../shared/sidebar-pages-settings'
import { useHostPoll } from '../hosts/host-poll'
import { waitingTotal } from '../hosts/merge-inbox'
import { useCapacityTotals } from '../pages/running/use-capacity'
import {
  setSidebarPagePinned,
  showSidebarPage,
  SIDEBAR_PAGES,
  useOpenSidebarPage,
  usePinnedPages
} from './sidebar-pages'

const WAITING_TOTAL_MS = 20_000

// The count on the Inbox row: every machine's open cards, whoever they are for (one person uses Pilot today).
export function useWaitingTotal(): number {
  const { reads } = useHostPoll<InboxListPayload>('pilot.inbox.list', {}, WAITING_TOTAL_MS)
  // A machine whose last read failed counts nothing: the pill never shows a stale count.
  return waitingTotal(reads.filter((r) => r.error === null))
}

const PILL_TONES = {
  // Cards that need Nish.
  attention: 'bg-primary text-primary-foreground',
  quiet: 'bg-worktree-sidebar-foreground/10 text-worktree-sidebar-foreground/70',
  waiting: 'bg-status-warning-background text-status-warning'
} as const

type NavPill = { count: number; tone: keyof typeof PILL_TONES; title?: string }

function Pills({ pills }: { pills: NavPill[] }): React.JSX.Element {
  return (
    <>
      {pills
        .filter((pill) => pill.count > 0)
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
    </>
  )
}

function InboxPills(): React.JSX.Element {
  return <Pills pills={[{ count: useWaitingTotal(), tone: 'attention' }]} />
}

// The Running page's own counts: runs going now, and in yellow the ones waiting.
function RunningPills(): React.JSX.Element {
  const { running, queued } = useCapacityTotals()
  return (
    <Pills
      pills={[
        { count: running, tone: 'quiet', title: 'Running now' },
        { count: queued, tone: 'waiting', title: 'Waiting' }
      ]}
    />
  )
}

const PAGE_PILLS: Partial<Record<SidebarPageKey, () => React.JSX.Element>> = {
  inbox: InboxPills,
  running: RunningPills
}

function PageNavRow({
  page,
  active,
  pinned
}: {
  page: SidebarPageKey
  active: boolean
  pinned: boolean
}): React.JSX.Element {
  const { label, icon: Icon } = SIDEBAR_PAGES[page]
  const PagePills = PAGE_PILLS[page]
  const row = (
    <button
      type="button"
      onClick={() => showSidebarPage(page)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring',
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
      {PagePills ? <PagePills /> : null}
    </button>
  )
  // A page shown only while it's open has nothing to unpin.
  if (!pinned) {
    return row
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => setSidebarPagePinned(page, false)}>
          <PinOff className="size-3.5" />
          Unpin from sidebar
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** The pinned pages as sidebar rows, and the open page while it's open. */
export function PinnedPagesNav(): React.JSX.Element | null {
  const pinned = usePinnedPages()
  const openPage = useOpenSidebarPage()
  const pages = sidebarNavPages(pinned, openPage)
  if (pages.length === 0) {
    return null
  }
  return (
    <nav aria-label="Pages" className="flex flex-col gap-0.5">
      {pages.map((page) => (
        <PageNavRow
          key={page}
          page={page}
          active={page === openPage}
          pinned={pinned.includes(page)}
        />
      ))}
    </nav>
  )
}
