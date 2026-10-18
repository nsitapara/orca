import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { InboxListRow } from '../../../shared/api-types'
import type { HostedSection } from '../../hosts/hosted-sections'
import type { Hosted } from '../../hosts/pilot-host'
import { DoneForYou, runsOfKeys } from './DoneForYou'
import type { useDoneForYou } from './use-done-for-you'

// The Done for you tab: finished runs with their defaults, then the defaults that have no run to sit under.
export function InboxDoneTab({
  done,
  defaults,
  defaultSections,
  cardFor,
  sectionOf,
  emptyText,
  onAcknowledged
}: {
  done: ReturnType<typeof useDoneForYou>
  defaults: readonly Hosted<InboxListRow>[]
  defaultSections: HostedSection[]
  cardFor: (cardKey: string) => React.ReactNode
  sectionOf: (s: HostedSection) => React.ReactNode
  emptyText: React.ReactNode
  onAcknowledged: () => Promise<unknown>
}): React.JSX.Element {
  // Only once every machine's Done for you list has answered cleanly: an error or a first load isn't "nothing".
  const settled =
    done.reads.length > 0 && done.reads.every((r) => r.value !== null && r.error === null)
  return (
    <>
      {done.error ? (
        <p className="text-sm text-destructive">{`Done for you couldn't load: ${done.error}`}</p>
      ) : null}
      <DoneForYou
        runs={done.runs}
        cardFor={cardFor}
        onAcknowledge={async (keys) => {
          const failed = await done.acknowledge(runsOfKeys(done.runs, keys))
          await onAcknowledged()
          return failed
        }}
      />
      {defaults.length ? (
        <Collapsible className="rounded-lg border border-border/50 px-3 py-2">
          <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm font-semibold">
            <span>Defaults without a run · {defaults.length}</span>
            <span className="text-xs font-normal text-muted-foreground">
              never counted as waiting
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 flex flex-col gap-3">
            {defaultSections.map(sectionOf)}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      {settled && done.runs.length === 0 && defaults.length === 0 ? emptyText : null}
    </>
  )
}
