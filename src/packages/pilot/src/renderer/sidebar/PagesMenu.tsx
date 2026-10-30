import { useState } from 'react'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { SIDEBAR_PAGE_KEYS } from '../../shared/sidebar-pages-settings'
import {
  setSidebarPagePinned,
  showSidebarPage,
  SIDEBAR_PAGES,
  useOpenSidebarPage,
  usePinnedPages
} from './sidebar-pages'

// Each row has two actions, open and pin, so this is a popover of buttons rather than a menu of items.
export function PagesMenu(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const pinned = usePinnedPages()
  const openPage = useOpenSidebarPage()
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Why the span: Tooltip and Popover must not compose refs onto one button. */}
          <span className="inline-flex shrink-0">
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Pages">
                <Menu className="size-3.5" strokeWidth={2.25} />
              </Button>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          Pages
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="start" sideOffset={6} className="w-60">
        <div className="p-1.5">
          <p className="px-2 pt-0.5 pb-1.5 text-[11px] text-muted-foreground">
            Open a page, or pin it to the sidebar
          </p>
          <ul className="flex flex-col gap-px">
            {SIDEBAR_PAGE_KEYS.map((page) => {
              const { label, icon: Icon } = SIDEBAR_PAGES[page]
              const isPinned = pinned.includes(page)
              return (
                <li key={page} className="flex items-center gap-1 rounded-md hover:bg-accent">
                  <button
                    type="button"
                    aria-current={page === openPage ? 'page' : undefined}
                    onClick={() => {
                      setOpen(false)
                      showSidebarPage(page)
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={isPinned}
                    aria-label={isPinned ? `Unpin ${label}` : `Pin ${label}`}
                    onClick={() => setSidebarPagePinned(page, !isPinned)}
                    className={cn(
                      'mr-1 shrink-0 rounded px-1.5 py-0.5 text-[11px] hover:bg-background/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                      isPinned ? 'font-medium text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {isPinned ? 'Pinned' : 'Pin'}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  )
}
