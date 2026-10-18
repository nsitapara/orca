import { useEffect, useMemo, useRef, useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { InboxListRow } from '../../../shared/api-types'
import { groupHostedItems, type HostedSection } from '../../hosts/hosted-sections'
import { HostsNotice } from '../../hosts/HostsNotice'
import { hostedKey, type Hosted } from '../../hosts/pilot-host'
import { useAutomationsFeed } from '../../run-views/automations-feed'
import { clearPendingInboxCard, usePendingInboxCard } from '../automations-view'
import { CardList } from './CardList'
import { DoneForYou, runsOfKeys } from './DoneForYou'
import { FilterBadges } from './FilterBadges'
import { setAllDetailsOpen, useAllDetailsOpen } from './details-open'
import { ALL, InboxHeader } from './InboxHeader'
import { InboxCard } from './InboxCard'
import { InboxStyle } from './inbox-style'
import { InMotionPanel } from './InMotionPanel'
import { WorktreeName } from './WorktreeLink'
import { useElementWidth } from './use-element-width'
import { useDoneForYou } from './use-done-for-you'
import { useListOpen } from './use-list-open'
import { useWaiting } from './use-waiting'

// The page's own width from which the card list sits beside the cards.
const WIDE_PX = 960

function withError(
  errors: Record<string, string>,
  id: string,
  failed: string | null
): Record<string, string> {
  const { [id]: _dropped, ...rest } = errors
  return failed ? { ...rest, [id]: failed } : rest
}

function SectionHeading({ section }: { section: HostedSection }): React.JSX.Element {
  return (
    <h2
      title={section.group.label}
      className="sticky top-0 z-20 -mx-5 truncate border-b border-border bg-background px-5 py-1.5 font-mono text-xs font-semibold text-muted-foreground"
    >
      <WorktreeName group={section.group} host={section.host} /> · {section.items.length}
    </h2>
  )
}

export function InboxPage(): React.JSX.Element {
  const [viewer, setViewer] = useState<string | null>(null)
  const [group, setGroup] = useState<string>(ALL)
  const [selected, setSelected] = useState<string | null>(null)
  const [listOpen, toggleList] = useListOpen()
  const [rootRef, width] = useElementWidth()
  const {
    inbox,
    queue,
    reads,
    queueReads,
    error,
    loadedAt,
    save,
    retryPreparation,
    prepareEvidence,
    applyNow,
    reload
  } = useWaiting(viewer)
  const done = useDoneForYou(viewer)
  const { list: summaries } = useAutomationsFeed()
  const running = summaries.flatMap((a) =>
    a.live.filter((r) => r.status === 'running').map((run) => ({ run, automationName: a.name }))
  )
  // A card the run panel's "asks you" link named: picked and scrolled to once the list has it, then forgotten.
  const pending = usePendingInboxCard()
  // The pending card the person picked another card over while it loaded: it is then dropped, not selected.
  const pickedOver = useRef<string | null>(null)
  useEffect(() => {
    if (!pending || !inbox) {
      return
    }
    // The pending card is a hostedKey; another machine's card can arrive in a later read than this machine's.
    const found = inbox.items.some((i) => hostedKey(i.host, i.id) === pending)
    if (!found && reads.some((r) => r.value === null && r.error === null)) {
      return
    }
    const picked = pickedOver.current === pending
    pickedOver.current = null
    clearPendingInboxCard()
    if (found && !picked) {
      setSelected(pending)
      document.getElementById(`card-${pending}`)?.scrollIntoView?.({ block: 'start' })
    }
  }, [pending, inbox, reads])
  // Save errors are kept here, by card hostedKey: a card remounts as a new version on every reload.
  const [errors, setErrors] = useState<Record<string, string>>({})
  const people = inbox?.people ?? []
  const firstPerson = people[0]?.id ?? null
  useEffect(() => {
    if (viewer === null && firstPerson) {
      setViewer(firstPerson)
    }
  }, [viewer, firstPerson])
  const items = useMemo(() => inbox?.items ?? [], [inbox])
  const automations = useMemo(() => inbox?.automations ?? [], [inbox])
  const names = useMemo(() => new Map(automations.map((a) => [a.id, a.name])), [automations])
  const openItems = items.filter((i) => i.type !== 'default')
  // Defaults show under their run in Done for you; only the rest (no run, or a run already seen) fold at the end.
  const itemKeys = new Set(items.map((i) => hostedKey(i.host, i.id)))
  const underRuns = new Set(
    done.runs
      .flatMap((d) => d.defaults.map((c) => hostedKey(d.run.host, c.id)))
      .filter((key) => itemKeys.has(key))
  )
  const defaults = items.filter(
    (i) => i.type === 'default' && !underRuns.has(hostedKey(i.host, i.id))
  )
  const sections = groupHostedItems(openItems, automations)
  // A selected group with no card left (its last one was answered) counts as All.
  const activeGroup = sections.some((s) => s.key === group) ? group : ALL
  const shown = sections.filter((s) => activeGroup === ALL || s.key === activeGroup)
  const defaultSections = groupHostedItems(defaults, automations).filter(
    (s) => activeGroup === ALL || s.key === activeGroup
  )
  const defaultCount = defaultSections.reduce((n, s) => n + s.items.length, 0)
  // By hostedKey, as each card's Details keeps its open state.
  const detailIds = useMemo(
    () => items.filter((i) => i.details || i.detailsMd).map((i) => hostedKey(i.host, i.id)),
    [items]
  )
  const allOpen = useAllDetailsOpen(detailIds)
  // The list sits beside the cards only on a wide page (measured on the page, not the window) while it is open.
  const wide = width === null || width >= WIDE_PX
  const showList = wide && listOpen
  const viewerName = people.find((p) => p.id === viewer)?.name.split(' ')[0] ?? 'you'
  const select = (item: Hosted<InboxListRow>) => {
    const key = hostedKey(item.host, item.id)
    pickedOver.current = pending
    setSelected(key)
    document.getElementById(`card-${key}`)?.scrollIntoView?.({ block: 'start' })
  }
  const cardOf = (i: Hosted<InboxListRow>) => {
    const key = hostedKey(i.host, i.id)
    return (
      <InboxCard
        key={`${key}@${i.version}`}
        item={i}
        automationName={names.get(i.automationId) ?? i.automationId}
        run={i.runId ? (inbox?.runs.get(hostedKey(i.host, i.runId)) ?? null) : null}
        runLine={inbox?.runLines.get(key) ?? null}
        answerState={inbox?.answerStates.get(key) ?? null}
        history={inbox?.history.get(key) ?? null}
        error={errors[key] ?? null}
        selected={selected === key}
        now={loadedAt}
        onSave={async (answer) => {
          const failed = await save(i, answer, viewer)
          setErrors((now) => withError(now, key, failed))
          return failed
        }}
        onRetryPreparation={() => retryPreparation(i)}
        onPrepareEvidence={() => prepareEvidence(i)}
      />
    )
  }
  const cardFor = (key: string) => {
    const item = items.find((i) => hostedKey(i.host, i.id) === key)
    return item ? cardOf(item) : null
  }
  const sectionOf = (s: HostedSection) => (
    <section key={s.key} aria-label={s.group.label} className="flex min-w-0 flex-col gap-3">
      <SectionHeading section={s} />
      {s.items.map(cardOf)}
    </section>
  )
  return (
    <div ref={rootRef} className="pilot-inbox flex flex-col gap-3 pt-6">
      <InboxStyle />
      <InboxHeader
        listOpen={listOpen}
        onToggleList={toggleList}
        people={people}
        viewer={viewer}
        onViewer={setViewer}
        wide={wide}
        canExpand={detailIds.length > 0}
        allOpen={allOpen}
        onToggleAll={() => setAllDetailsOpen(detailIds, !allOpen)}
      />
      <InMotionPanel running={running} entries={queue} onApplyNow={applyNow} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <HostsNotice
        reads={reads}
        what="cards"
        also={[
          { reads: queueReads, what: 'queued answers' },
          { reads: done.reads, what: 'Done for you runs' }
        ]}
      />
      {showList ? null : (
        <FilterBadges
          sections={sections}
          total={openItems.length}
          group={activeGroup}
          onGroup={setGroup}
        />
      )}
      <div className="flex flex-wrap items-start gap-4">
        {showList ? (
          <CardList
            sections={sections}
            total={openItems.length}
            group={activeGroup}
            selected={selected}
            names={names}
            now={loadedAt}
            onGroup={setGroup}
            onSelect={select}
          />
        ) : null}
        <main className="flex min-w-0 flex-[999_1_480px] flex-col gap-3">
          {shown.length ? (
            shown.map(sectionOf)
          ) : (
            <p className="text-sm text-muted-foreground">Nothing waiting on {viewerName} here.</p>
          )}
          {done.error ? (
            <p className="text-sm text-destructive">{`Done for you couldn't load: ${done.error}`}</p>
          ) : null}
          <DoneForYou
            runs={done.runs}
            cardFor={cardFor}
            onAcknowledge={async (keys) => {
              const failed = await done.acknowledge(runsOfKeys(done.runs, keys))
              await reload()
              return failed
            }}
          />
          {defaultCount ? (
            <Collapsible className="rounded-lg border border-border/50 px-3 py-2">
              <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm font-semibold">
                <span>Defaults without a run · {defaultCount}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  never counted as waiting
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 flex flex-col gap-3">
                {defaultSections.map(sectionOf)}
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </main>
      </div>
    </div>
  )
}
