import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { InboxItemRow } from '../../../shared/api-types'
import type { DetailsSnapshot } from '../../../shared/details'
import { pilotRpc } from '../../api'
import { DetailsStyle } from '../../details/details-css'
import { DetailsView } from '../../details/DetailsView'
import { Markdown } from '../../details/markdown'
import type { PartSwitches } from '../../details/ReviewBlock'
import { setDetailsOpen, useDetailsOpen } from './details-open'

// Snapshots by `${id}@${digest}`, newest last, capped: a snapshot is bound to one digest and never changes.
const SNAPSHOTS = new Map<string, DetailsSnapshot>()
const MAX_SNAPSHOTS = 30

function remember(key: string, snapshot: DetailsSnapshot): void {
  SNAPSHOTS.delete(key)
  SNAPSHOTS.set(key, snapshot)
  while (SNAPSHOTS.size > MAX_SNAPSHOTS) {
    const oldest = SNAPSHOTS.keys().next().value
    if (oldest === undefined) {
      break
    }
    SNAPSHOTS.delete(oldest)
  }
}

type Loaded = { key: string; snapshot: DetailsSnapshot | null; error: string | null }
type Snapshot = { loaded: Loaded | null; retry: () => void }

function whyOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function useSnapshot(item: InboxItemRow, open: boolean): Snapshot {
  const { id, digest } = item
  const wanted = item.details !== null && open
  const key = `${id}@${digest}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!wanted || SNAPSHOTS.has(key)) {
      return undefined
    }
    let live = true
    pilotRpc<{ snapshot: DetailsSnapshot }>('pilot.inbox.details', { id, digest }).then(
      (result) => {
        remember(key, result.snapshot)
        if (live) {
          setLoaded({ key, snapshot: result.snapshot, error: null })
        }
      },
      (error: unknown) => {
        if (live) {
          setLoaded({ key, snapshot: null, error: whyOf(error) })
        }
      }
    )
    return () => {
      live = false
    }
  }, [wanted, key, id, digest, attempt])
  const cached = SNAPSHOTS.get(key)
  const retry = () => {
    setLoaded(null)
    setAttempt((n) => n + 1)
  }
  if (wanted && cached) {
    return { loaded: { key, snapshot: cached, error: null }, retry }
  }
  return { loaded: loaded?.key === key ? loaded : null, retry }
}

function base64Url(mime: string, base64: string): string {
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i)
  }
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}

function BundleBody({
  item,
  loaded,
  retry,
  parts
}: {
  item: InboxItemRow
  loaded: Loaded | null
  retry: () => void
  parts: PartSwitches | null
}): React.JSX.Element | null {
  if (!loaded) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }
  if (loaded.error || !loaded.snapshot) {
    return (
      <p className="text-sm text-destructive">
        Couldn&apos;t load the details: {loaded.error}{' '}
        <button type="button" className="underline underline-offset-4" onClick={retry}>
          Retry
        </button>
      </p>
    )
  }
  const loadImage = async (file: string): Promise<string> => {
    const image = await pilotRpc<{ mime: string; base64: string }>('pilot.inbox.image', {
      id: item.id,
      digest: item.digest,
      file
    })
    return base64Url(image.mime, image.base64)
  }
  return <DetailsView snapshot={loaded.snapshot} loadImage={loadImage} parts={parts} />
}

function Body({
  item,
  open,
  parts
}: {
  item: InboxItemRow
  open: boolean
  parts: PartSwitches | null
}): React.JSX.Element | null {
  const { loaded, retry } = useSnapshot(item, open)
  if (item.details) {
    return <BundleBody item={item} loaded={loaded} retry={retry} parts={parts} />
  }
  return (
    <div className="glr glr-body min-w-0">
      <DetailsStyle />
      <Markdown source={item.detailsMd ?? ''} />
    </div>
  )
}

// The labels beside "Details" on the bar (the ref's derived summary); a markdown-only card has none.
function SummaryChips({ item }: { item: InboxItemRow }): React.JSX.Element[] {
  return (item.details?.summary ?? []).map((label) => (
    <span
      key={label}
      className="rounded bg-muted px-1.5 font-mono text-[11.5px] leading-[1.7] font-medium text-muted-foreground"
    >
      {label}
    </span>
  ))
}

// The card's Details as a panel of its own: a bar (arrow, "Details", summary chips, Show or Hide) that is the
// toggle, and the Details below it when open.
export function CardDetails({
  item,
  parts
}: {
  item: InboxItemRow
  parts: PartSwitches | null
}): React.JSX.Element | null {
  const open = useDetailsOpen(item.id)
  if (!item.details && !item.detailsMd) {
    return null
  }
  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => setDetailsOpen(item.id, next)}
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-background/60"
    >
      <CollapsibleTrigger className="group flex w-full flex-wrap items-center gap-2 bg-muted/60 px-3 py-2 text-left">
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90"
        />
        <span className="text-[13px] font-bold">Details</span>
        <SummaryChips item={item} />
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">{open ? 'Hide' : 'Show'}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="min-w-0 border-t border-border p-3">
        <Body item={item} open={open} parts={parts} />
      </CollapsibleContent>
    </Collapsible>
  )
}
