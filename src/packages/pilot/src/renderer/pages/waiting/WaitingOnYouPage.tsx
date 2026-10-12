import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { InboxItemRow } from '../../../shared/api-types'
import { waitingCount, worktreeName } from './answer-text'
import { ImportVaultPanel } from './ImportVaultPanel'
import { InboxCard } from './InboxCard'
import { UpNextPanel } from './UpNextPanel'
import { useWaiting } from './use-waiting'

const ALL = 'all'

function railKey(item: InboxItemRow): string {
  return item.worktreePath ?? ''
}

function withError(
  errors: Record<string, string>,
  id: string,
  failed: string | null
): Record<string, string> {
  const { [id]: _dropped, ...rest } = errors
  return failed ? { ...rest, [id]: failed } : rest
}

export function WaitingOnYouPage(): React.JSX.Element {
  const [viewer, setViewer] = useState<string | null>(null)
  const [rail, setRail] = useState<string>(ALL)
  const { inbox, queue, error, save, applyNow, reload } = useWaiting(viewer)
  // Save errors are kept here, by card id: a card remounts as a new version on every reload.
  const [errors, setErrors] = useState<Record<string, string>>({})
  const people = inbox?.people ?? []
  const firstPerson = people[0]?.id ?? null
  useEffect(() => {
    if (viewer === null && firstPerson) {
      setViewer(firstPerson)
    }
  }, [viewer, firstPerson])
  const items = inbox?.items ?? []
  const names = useMemo(
    () => new Map((inbox?.automations ?? []).map((a) => [a.id, a.name])),
    [inbox]
  )
  const worktrees = [...new Set(items.map(railKey))]
  const shown = items.filter((i) => rail === ALL || railKey(i) === rail)
  const open = shown.filter((i) => i.type !== 'default')
  const defaults = shown.filter((i) => i.type === 'default')
  const viewerName = people.find((p) => p.id === viewer)?.name.split(' ')[0] ?? 'you'
  const cardOf = (i: InboxItemRow) => (
    <InboxCard
      key={`${i.id}@${i.version}`}
      item={i}
      automationName={names.get(i.automationId) ?? i.automationId}
      queued={queue.find((q) => q.itemId === i.id) ?? null}
      error={errors[i.id] ?? null}
      onSave={async (answer) => {
        const failed = await save(i, answer, viewer)
        setErrors((now) => withError(now, i.id, failed))
        return failed
      }}
    />
  )
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Waiting on you</h2>
        <span className="flex-1" />
        <span className="text-sm text-muted-foreground">Viewing as</span>
        {people.map((p) => (
          <Button
            key={p.id}
            size="xs"
            variant={p.id === viewer ? 'secondary' : 'ghost'}
            onClick={() => setViewer(p.id)}
          >
            {p.name}
          </Button>
        ))}
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">
        Every automation leaves its questions and actions here, addressed to a person. An approved
        action runs its script with no agent; any other answer goes back to the session that asked.
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <ImportVaultPanel onImported={() => void reload()} />
      <UpNextPanel entries={queue} onApplyNow={applyNow} />
      <div className="grid grid-cols-[minmax(10rem,14rem)_1fr] gap-4">
        <nav className="flex flex-col gap-1">
          <Button
            variant={rail === ALL ? 'secondary' : 'ghost'}
            size="sm"
            className="justify-between"
            onClick={() => setRail(ALL)}
          >
            <span>All worktrees</span>
            <span>{waitingCount(items) || ''}</span>
          </Button>
          {worktrees.map((w) => (
            <Button
              key={w}
              variant={rail === w ? 'secondary' : 'ghost'}
              size="sm"
              className="justify-between"
              onClick={() => setRail(w)}
            >
              <span className="truncate">{worktreeName(w || null)}</span>
              <span>{waitingCount(items.filter((i) => railKey(i) === w)) || ''}</span>
            </Button>
          ))}
        </nav>
        <div className="flex flex-col gap-3">
          {open.length ? (
            open.map(cardOf)
          ) : (
            <p className="text-sm text-muted-foreground">Nothing waiting on {viewerName} here.</p>
          )}
          {defaults.length ? (
            <Collapsible className="rounded-lg border border-border/50 px-3 py-2">
              <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm font-semibold">
                <span>Defaults the agents took · {defaults.length}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  never counted as waiting
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 flex flex-col gap-3">
                {defaults.map(cardOf)}
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
      </div>
    </div>
  )
}
