import { useEffect, useMemo, useRef, useState } from 'react'
import type { InboxListRow } from '../../../shared/api-types'
import { groupHostedItems, type HostedSection } from '../../hosts/hosted-sections'
import { groupHostedItemsBy } from '../../hosts/inbox-grouping'
import { HostsNotice } from '../../hosts/HostsNotice'
import { hostedKey, type Hosted } from '../../hosts/pilot-host'
import { useAutomationsFeed } from '../../run-views/automations-feed'
import { motionSafeScrollBehavior } from '@/hooks/usePrefersReducedMotion'
import { clearPendingInboxCard, usePendingInboxCard } from '../automations-view'
import type { Answer } from './answer-types'
import { CardList } from './CardList'
import { FilterBadges } from './FilterBadges'
import { setAllDetailsOpen, useAllDetailsOpen } from './details-open'
import { ALL, InboxHeader } from './InboxHeader'
import { InboxCard } from './InboxCard'
import { InboxDoneTab } from './InboxDoneTab'
import { InboxFilters } from './InboxFilters'
import { InboxFocus } from './InboxFocus'
import { InboxRows } from './InboxRows'
import { InboxTabs } from './InboxTabs'
import { InboxStyle } from './inbox-style'
import {
  emptyTabText,
  inTab,
  kindCounts,
  matchesFilters,
  preparingNote,
  tabCounts,
  tabLabel,
  type CardFilters
} from './inbox-tabs'
import { useInboxViewPrefs } from './inbox-view-prefs'
import { InMotionPanel } from './InMotionPanel'
import { WorktreeName } from './WorktreeLink'
import { useElementWidth } from './use-element-width'
import { useDoneForYou } from './use-done-for-you'
import { useListOpen } from './use-list-open'
import { useWaiting } from './use-waiting'

// The page's own width from which the card list sits beside the cards.
const WIDE_PX = 960
const NO_FILTERS: CardFilters = { kinds: [], query: '' }
// Group by Nothing makes one section with no label: its region still needs a name.
const UNGROUPED_NAME = 'Cards'

function withError(
  errors: Record<string, string>,
  id: string,
  failed: string | null
): Record<string, string> {
  const { [id]: _dropped, ...rest } = errors
  return failed ? { ...rest, [id]: failed } : rest
}

function keysOf(items: readonly Hosted<InboxListRow>[]): Set<string> {
  return new Set(items.map((i) => hostedKey(i.host, i.id)))
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
  // The section picked in the list or the badges (a section key), apart from the Group by mode.
  const [section, setSection] = useState<string>(ALL)
  const [prefs, setPrefs] = useInboxViewPrefs()
  const [filters, setFilters] = useState<CardFilters>(NO_FILTERS)
  const [selected, setSelected] = useState<string | null>(null)
  // The card Rows' Open named: scrolled to once the Cards view has mounted it.
  const [scrollTo, setScrollTo] = useState<string | null>(null)
  // The card One at a time shows, by position, kept with the tab/filters/grouping it was picked under.
  const [focus, setFocus] = useState({ scope: '', at: 0 })
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
  // Each card's Worktree heading by hostedKey: what search matches, and what a list row names under another grouping.
  const places = new Map(
    groupHostedItems(openItems, automations).flatMap((s) =>
      s.items.map((i) => [hostedKey(i.host, i.id), s.group.label] as const)
    )
  )
  const { tab } = prefs
  const onDone = tab === 'done'
  const inTabItems = onDone
    ? []
    : openItems.filter((i) =>
        inTab(i, tab, inbox?.answerStates.get(hostedKey(i.host, i.id)) ?? null)
      )
  const filtered = filters.kinds.length > 0 || filters.query.trim() !== ''
  const shownItems = inTabItems.filter((i) =>
    matchesFilters(i, filters, places.get(hostedKey(i.host, i.id)) ?? '')
  )
  const sections = groupHostedItemsBy(shownItems, automations, prefs.group, prefs.sort, loadedAt)
  // A picked section with no card left (its last one was answered, or the tab moved) counts as All.
  const activeSection = sections.some((s) => s.key === section) ? section : ALL
  const shown = sections.filter((s) => activeSection === ALL || s.key === activeSection)
  // Defaults show under their run in Done for you; only the rest (no run, or a run already seen) fold at the end.
  const itemKeys = keysOf(items)
  const underRuns = new Set(
    done.runs
      .flatMap((d) => d.defaults.map((c) => hostedKey(d.run.host, c.id)))
      .filter((key) => itemKeys.has(key))
  )
  const allDefaults = items.filter((i) => i.type === 'default')
  const defaults = allDefaults.filter((i) => !underRuns.has(hostedKey(i.host, i.id)))
  // The cards on screen: every default on Done for you, else the shown sections' cards.
  const visibleKeys = keysOf(onDone ? allDefaults : shown.flatMap((s) => s.items))
  useEffect(() => {
    if (!pending || !inbox) {
      return
    }
    // The pending card is a hostedKey; another machine's card can arrive in a later read than this machine's.
    const found = inbox.items.find((i) => hostedKey(i.host, i.id) === pending)
    if (!found && reads.some((r) => r.value === null && r.error === null)) {
      return
    }
    const picked = pickedOver.current === pending
    if (found && !picked && !visibleKeys.has(pending)) {
      const home = found.type === 'default' ? 'done' : 'all'
      // Hidden by the tab, a filter or the picked section: show it unfiltered, and pick it on the next render.
      if (tab !== home || filtered || activeSection !== ALL) {
        setPrefs({ tab: home })
        setFilters(NO_FILTERS)
        setSection(ALL)
        return
      }
    }
    pickedOver.current = null
    clearPendingInboxCard()
    if (found && !picked) {
      setSelected(pending)
      document.getElementById(`card-${pending}`)?.scrollIntoView?.({ block: 'start' })
    }
  }, [pending, inbox, reads, visibleKeys, tab, filtered, activeSection, setPrefs])
  // A pick the tab, filters or grouping now hide is dropped, so it doesn't come back with them.
  useEffect(() => {
    if (selected !== null && !visibleKeys.has(selected)) {
      setSelected(null)
    }
  }, [selected, visibleKeys])
  // By hostedKey, as each card's Details keeps its open state.
  const detailIds = useMemo(
    () => items.filter((i) => i.details || i.detailsMd).map((i) => hostedKey(i.host, i.id)),
    [items]
  )
  const allOpen = useAllDetailsOpen(detailIds)
  // The list sits beside the cards only on a wide page (measured on the page, not the window) while it is open.
  const wide = width === null || width >= WIDE_PX
  const showList = wide && listOpen && !onDone && prefs.view === 'cards'
  const viewerName = people.find((p) => p.id === viewer)?.name.split(' ')[0] ?? 'you'
  const select = (item: Hosted<InboxListRow>) => {
    const key = hostedKey(item.host, item.id)
    pickedOver.current = pending
    setSelected(key)
    document.getElementById(`card-${key}`)?.scrollIntoView?.({ block: 'start' })
  }
  const onSave = async (i: Hosted<InboxListRow>, answer: Answer) => {
    const key = hostedKey(i.host, i.id)
    const failed = await save(i, answer, viewer)
    setErrors((now) => withError(now, key, failed))
    return failed
  }
  const openInCards = (item: Hosted<InboxListRow>) => {
    setPrefs({ view: 'cards' })
    setSelected(hostedKey(item.host, item.id))
    setScrollTo(hostedKey(item.host, item.id))
  }
  useEffect(() => {
    if (scrollTo === null || prefs.view !== 'cards') {
      return
    }
    document
      .getElementById(`card-${scrollTo}`)
      ?.scrollIntoView?.({ block: 'start', behavior: motionSafeScrollBehavior() })
    setScrollTo(null)
  }, [scrollTo, prefs.view])
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
        preparationWait={inbox?.preparationWaits.get(key) ?? null}
        error={errors[key] ?? null}
        selected={selected === key}
        now={loadedAt}
        onSave={(answer) => onSave(i, answer)}
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
    <section
      key={s.key}
      aria-label={s.group.label || UNGROUPED_NAME}
      className="flex min-w-0 flex-col gap-3"
    >
      {s.group.label ? <SectionHeading section={s} /> : null}
      {s.items.map(cardOf)}
    </section>
  )
  const emptyText = (
    <p className="text-sm text-muted-foreground">{emptyTabText(tab, filtered, viewerName)}</p>
  )
  const rowsBody = (
    <InboxRows
      sections={shown}
      answerStates={inbox?.answerStates ?? new Map()}
      names={names}
      errors={errors}
      now={loadedAt}
      onAnswer={(item, answer) => void onSave(item, answer)}
      onOpen={openInCards}
    />
  )
  const focusScope = [tab, filters.kinds.join(), filters.query, prefs.group, prefs.sort].join('|')
  const focusBody = (
    <InboxFocus
      cards={shown.flatMap((s) => s.items)}
      at={focus.scope === focusScope ? focus.at : 0}
      onAt={(at) => setFocus({ scope: focusScope, at })}
      renderCard={cardOf}
      tabLabel={tabLabel(tab)}
      onExit={() => setPrefs({ view: 'cards' })}
    />
  )
  const listBodies = { rows: rowsBody, focus: focusBody, cards: shown.map(sectionOf) }
  const listBody = listBodies[prefs.view]
  const cardsBody = shown.length ? listBody : emptyText
  const defaultSections = groupHostedItems(defaults, automations)
  const doneBody = (
    <InboxDoneTab
      done={done}
      defaults={defaults}
      defaultSections={defaultSections}
      cardFor={cardFor}
      sectionOf={sectionOf}
      emptyText={emptyText}
      onAcknowledged={reload}
    />
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
      <InboxTabs
        tab={tab}
        counts={tabCounts(items)}
        preparingNote={preparingNote(
          items,
          (i) => inbox?.preparationWaits.has(hostedKey(i.host, i.id)) ?? false
        )}
        doneCount={done.runs.length}
        onTab={(next) => setPrefs({ tab: next })}
      />
      {onDone ? null : (
        <InboxFilters
          filters={filters}
          kindCounts={kindCounts(inTabItems)}
          shown={shownItems.length}
          total={inTabItems.length}
          group={prefs.group}
          sort={prefs.sort}
          view={prefs.view}
          onFilters={setFilters}
          onGroup={(group) => setPrefs({ group })}
          onSort={(sort) => setPrefs({ sort })}
          onView={(view) => setPrefs({ view })}
        />
      )}
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
      {showList || onDone ? null : (
        <FilterBadges
          sections={sections}
          total={shownItems.length}
          group={activeSection}
          onGroup={setSection}
        />
      )}
      <div className="flex flex-wrap items-start gap-4">
        {showList ? (
          <CardList
            sections={sections}
            total={shownItems.length}
            group={activeSection}
            selected={selected}
            names={names}
            places={prefs.group === 'worktree' ? null : places}
            now={loadedAt}
            onGroup={setSection}
            onSelect={select}
          />
        ) : null}
        <main className="flex min-w-0 flex-[999_1_480px] flex-col gap-3">
          {onDone ? doneBody : cardsBody}
        </main>
      </div>
    </div>
  )
}
