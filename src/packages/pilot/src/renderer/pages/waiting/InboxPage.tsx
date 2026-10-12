import { useEffect, useMemo, useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { InboxItemRow } from '../../../shared/api-types'
import { groupItems, type Section } from '../../../shared/inbox-groups'
import { waitingCount } from './answer-text'
import { CardList } from './CardList'
import { FilterBadges } from './FilterBadges'
import { setAllDetailsOpen, useAllDetailsOpen } from './details-open'
import { ALL, InboxHeader } from './InboxHeader'
import { InboxCard } from './InboxCard'
import { ImportNotice } from './ImportNotice'
import { InboxStyle } from './inbox-style'
import { UpNextPanel } from './UpNextPanel'
import { useElementWidth } from './use-element-width'
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

function SectionHeading({ section }: { section: Section }): React.JSX.Element {
  return (
    <h2
      title={section.group.label}
      className="sticky top-0 z-20 -mx-5 truncate border-b border-border bg-background px-5 py-1.5 font-mono text-xs font-semibold text-muted-foreground"
    >
      <span className="text-foreground">{section.group.label}</span> · {section.items.length}
    </h2>
  )
}

export function InboxPage(): React.JSX.Element {
  const [viewer, setViewer] = useState<string | null>(null)
  const [group, setGroup] = useState<string>(ALL)
  const [selected, setSelected] = useState<string | null>(null)
  const [listOpen, toggleList] = useListOpen()
  const [rootRef, width] = useElementWidth()
  const { inbox, queue, error, loadedAt, save, applyNow, reload } = useWaiting(viewer)
  // Save errors are kept here, by card id: a card remounts as a new version on every reload.
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
  const defaults = items.filter((i) => i.type === 'default')
  const sections = groupItems(openItems, automations)
  // A selected group with no card left (its last one was answered) counts as All.
  const activeGroup = sections.some((s) => s.group.key === group) ? group : ALL
  const shown = sections.filter((s) => activeGroup === ALL || s.group.key === activeGroup)
  const defaultSections = groupItems(defaults, automations).filter(
    (s) => activeGroup === ALL || s.group.key === activeGroup
  )
  const defaultCount = defaultSections.reduce((n, s) => n + s.items.length, 0)
  const detailIds = useMemo(
    () => items.filter((i) => i.details || i.detailsMd).map((i) => i.id),
    [items]
  )
  const allOpen = useAllDetailsOpen(detailIds)
  // The list sits beside the cards only on a wide page (measured on the page, not the window) while it is open.
  const wide = width === null || width >= WIDE_PX
  const showList = wide && listOpen
  const viewerName = people.find((p) => p.id === viewer)?.name.split(' ')[0] ?? 'you'
  const select = (item: InboxItemRow) => {
    setSelected(item.id)
    document.getElementById(`card-${item.id}`)?.scrollIntoView?.({ block: 'start' })
  }
  const cardOf = (i: InboxItemRow) => (
    <InboxCard
      key={`${i.id}@${i.version}`}
      item={i}
      automationName={names.get(i.automationId) ?? i.automationId}
      runLine={inbox?.runLines[i.id] ?? null}
      queued={queue.find((q) => q.itemId === i.id) ?? null}
      error={errors[i.id] ?? null}
      selected={selected === i.id}
      now={loadedAt}
      onSave={async (answer) => {
        const failed = await save(i, answer, viewer)
        setErrors((now) => withError(now, i.id, failed))
        return failed
      }}
    />
  )
  const sectionOf = (s: Section) => (
    <section key={s.group.key} aria-label={s.group.label} className="flex min-w-0 flex-col gap-3">
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
        waiting={waitingCount(items)}
        people={people}
        viewer={viewer}
        onViewer={setViewer}
        wide={wide}
        canExpand={detailIds.length > 0}
        allOpen={allOpen}
        onToggleAll={() => setAllDetailsOpen(detailIds, !allOpen)}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <ImportNotice onImported={() => void reload()} />
      {showList ? null : (
        <FilterBadges
          sections={sections}
          total={openItems.length}
          group={activeGroup}
          onGroup={setGroup}
        />
      )}
      <UpNextPanel entries={queue} onApplyNow={applyNow} />
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
          {defaultCount ? (
            <Collapsible className="rounded-lg border border-border/50 px-3 py-2">
              <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm font-semibold">
                <span>Defaults the agents took · {defaultCount}</span>
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
