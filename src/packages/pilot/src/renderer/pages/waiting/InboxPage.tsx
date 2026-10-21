import { useCallback, useEffect, useMemo, useState } from 'react'
import type { InboxListRow } from '../../../shared/api-types'
import type { HostedSection } from '../../hosts/hosted-sections'
import { HostsNotice } from '../../hosts/HostsNotice'
import { hostedKey, type Hosted } from '../../hosts/pilot-host'
import { useAutomationsFeed } from '../../run-views/automations-feed'
import { motionSafeScrollBehavior } from '@/hooks/usePrefersReducedMotion'
import type { Answer } from './answer-types'
import { CardList } from './CardList'
import { FilterBadges } from './FilterBadges'
import { setAllDetailsOpen, useAllDetailsOpen } from './details-open'
import { ALL, InboxHeader } from './InboxHeader'
import { InboxCard } from './InboxCard'
import { InboxFilters } from './InboxFilters'
import { type FocusPlace, InboxFocus } from './InboxFocus'
import { InboxRows } from './InboxRows'
import { InboxTabs } from './InboxTabs'
import { InboxViewControls } from './InboxViewControls'
import { InboxStyle } from './inbox-style'
import {
  emptyTabText,
  kindCounts,
  preparingNote,
  tabCounts,
  tabLabel,
  type CardFilters
} from './inbox-tabs'
import { useInboxViewPrefs } from './inbox-view-prefs'
import { InMotionPanel } from './InMotionPanel'
import { KindSection } from './KindFilter'
import { ProjectBlock } from './ProjectLine'
import { SectionHeading } from './SectionHeading'
import { useElementWidth } from './use-element-width'
import { useInboxSections } from './use-inbox-sections'
import { useListOpen } from './use-list-open'
import { usePendingInboxCardPick } from './use-pending-inbox-card'
import { useWaiting } from './use-waiting'

// The page's own width from which the card list sits beside the cards.
const WIDE_PX = 960
const NO_FILTERS: CardFilters = { kinds: [] }
const FIRST_CARD: FocusPlace = { key: null, at: 0 }
// Group by Nothing makes one section with no label: its region still needs a name.
const UNGROUPED_NAME = 'All cards'

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

export function InboxPage(): React.JSX.Element {
  const [viewer, setViewer] = useState<string | null>(null)
  // The section picked in the list or the badges (a section key), apart from the Group by mode.
  const [section, setSection] = useState<string>(ALL)
  const [prefs, setPrefs] = useInboxViewPrefs()
  const [filters, setFilters] = useState<CardFilters>(NO_FILTERS)
  const [selected, setSelected] = useState<string | null>(null)
  // The card Rows' Open named: scrolled to once the Cards view has mounted it.
  const [scrollTo, setScrollTo] = useState<string | null>(null)
  // The card One at a time shows, kept with the tab/filters/grouping it was picked under.
  const [focus, setFocus] = useState<FocusPlace & { scope: string }>({ ...FIRST_CARD, scope: '' })
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
  const { list: summaries } = useAutomationsFeed()
  const running = summaries.flatMap((a) =>
    a.live.filter((r) => r.status === 'running').map((run) => ({ run, automationName: a.name }))
  )
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
  const { tab } = prefs
  const {
    filtered,
    homes,
    places,
    inTabItems,
    shownItems,
    sections,
    activeSection,
    shown,
    projects,
    shownProjects
  } = useInboxSections({
    inbox,
    tab,
    filters,
    group: prefs.group,
    sort: prefs.sort,
    section,
    now: loadedAt
  })
  const visibleKeys = keysOf(shown.flatMap((s) => s.items))
  const notePick = usePendingInboxCardPick({
    items: inbox?.items ?? null,
    loading: reads.some((r) => r.value === null && r.error === null),
    visibleKeys,
    tab,
    filtered,
    section: activeSection,
    view: prefs.view,
    setPrefs,
    unfilter: () => {
      setFilters(NO_FILTERS)
      setSection(ALL)
    },
    pick: (key) => {
      setSelected(key)
      document.getElementById(`card-${key}`)?.scrollIntoView?.({ block: 'start' })
    }
  })
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
  const showList = wide && listOpen && prefs.view === 'cards'
  const viewerName = people.find((p) => p.id === viewer)?.name.split(' ')[0] ?? 'you'
  const select = (item: Hosted<InboxListRow>) => {
    const key = hostedKey(item.host, item.id)
    notePick()
    setSelected(key)
    document.getElementById(`card-${key}`)?.scrollIntoView?.({ block: 'start' })
  }
  // Stable, with the card renderers below, so a render that changes no card keeps the card bodies.
  const onSave = useCallback(
    async (i: Hosted<InboxListRow>, answer: Answer) => {
      const key = hostedKey(i.host, i.id)
      const failed = await save(i, answer, viewer)
      setErrors((now) => withError(now, key, failed))
      return failed
    },
    [save, viewer]
  )
  const openInCards = useCallback(
    (item: Hosted<InboxListRow>) => {
      setPrefs({ view: 'cards' })
      setSelected(hostedKey(item.host, item.id))
      setScrollTo(hostedKey(item.host, item.id))
    },
    [setPrefs]
  )
  useEffect(() => {
    if (scrollTo === null || prefs.view !== 'cards') {
      return
    }
    document
      .getElementById(`card-${scrollTo}`)
      ?.scrollIntoView?.({ block: 'start', behavior: motionSafeScrollBehavior() })
    setScrollTo(null)
  }, [scrollTo, prefs.view])
  // `section`: the section the card is listed under, null when it is shown on its own.
  const cardOf = useCallback(
    (i: Hosted<InboxListRow>, section: string | null) => {
      const key = hostedKey(i.host, i.id)
      return (
        <InboxCard
          key={`${key}@${i.version}`}
          item={i}
          automationName={names.get(i.automationId) ?? i.automationId}
          home={homes.get(key) ?? null}
          section={section}
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
          onTicketed={() => void reload()}
        />
      )
    },
    [
      names,
      homes,
      inbox,
      errors,
      selected,
      loadedAt,
      onSave,
      retryPreparation,
      prepareEvidence,
      reload
    ]
  )
  const sectionIn = useCallback(
    (s: HostedSection, project?: string | null) => (
      <section
        key={s.key}
        aria-label={s.group.label || UNGROUPED_NAME}
        className="flex min-w-0 flex-col gap-3"
      >
        {s.group.label ? (
          <SectionHeading section={s} project={project} besideList={showList} />
        ) : null}
        {s.items.map((i) => cardOf(i, s.key))}
      </section>
    ),
    [cardOf, showList]
  )
  const emptyText = (
    <p className="text-sm text-muted-foreground">{emptyTabText(tab, filtered, viewerName)}</p>
  )
  const focusScope = [tab, filters.kinds.join(), prefs.group, prefs.sort].join('|')
  const { view, group } = prefs
  const listBody = useMemo(() => {
    if (view === 'rows') {
      return (
        <InboxRows
          sections={shown}
          projects={shownProjects}
          answerStates={inbox?.answerStates ?? new Map()}
          names={names}
          places={group === 'worktree' ? null : places}
          errors={errors}
          now={loadedAt}
          onAnswer={onSave}
          onOpen={openInCards}
        />
      )
    }
    if (view === 'focus') {
      return (
        <InboxFocus
          cards={shown.flatMap((s) => s.items)}
          place={focus.scope === focusScope ? focus : FIRST_CARD}
          onPlace={(place) => setFocus({ ...place, scope: focusScope })}
          renderCard={(i) => cardOf(i, null)}
          tabLabel={tabLabel(tab)}
          onExit={() => setPrefs({ view: 'cards' })}
        />
      )
    }
    if (shownProjects) {
      return shownProjects.map((p) => (
        <ProjectBlock key={p.key} project={p}>
          {p.sections.map((s) => sectionIn(s, p.name))}
        </ProjectBlock>
      ))
    }
    return shown.map((s) => sectionIn(s))
  }, [
    view,
    group,
    shown,
    inbox,
    names,
    places,
    errors,
    loadedAt,
    onSave,
    openInCards,
    focus,
    focusScope,
    cardOf,
    tab,
    setPrefs,
    sectionIn,
    shownProjects
  ])
  const cardsBody = shown.length ? listBody : emptyText
  const kindFilter = {
    kinds: filters.kinds,
    counts: kindCounts(inTabItems),
    shown: shownItems.length,
    total: inTabItems.length,
    onKinds: (kinds: CardFilters['kinds']) => setFilters({ kinds })
  }
  const viewControls = (
    <InboxViewControls
      group={prefs.group}
      sort={prefs.sort}
      view={prefs.view}
      onGroup={(group) => {
        // A section picked under another grouping would come back when this one returns.
        setPrefs({ group })
        setSection(ALL)
      }}
      onSort={(sort) => setPrefs({ sort })}
      onView={(view) => setPrefs({ view })}
    />
  )
  return (
    <div ref={rootRef} className="pilot-inbox flex flex-col gap-3 pt-6">
      <InboxStyle />
      <InboxHeader
        listOpen={listOpen}
        onToggleList={toggleList}
        wide={wide}
        canExpand={detailIds.length > 0}
        allOpen={allOpen}
        onToggleAll={() => setAllDetailsOpen(detailIds, !allOpen)}
        tabs={
          <InboxTabs
            tab={tab}
            counts={tabCounts(items)}
            preparingNote={preparingNote(
              items,
              (i) => inbox?.preparationWaits.has(hostedKey(i.host, i.id)) ?? false
            )}
            onTab={(next) => setPrefs({ tab: next })}
          />
        }
        controls={showList ? viewControls : null}
      />
      {showList ? null : <InboxFilters {...kindFilter} controls={viewControls} />}
      <InMotionPanel running={running} entries={queue} onApplyNow={applyNow} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <HostsNotice
        reads={reads}
        what="cards"
        also={[{ reads: queueReads, what: 'queued answers' }]}
      />
      {showList ? null : (
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
            kinds={<KindSection {...kindFilter} />}
            sections={sections}
            projects={projects}
            group={activeSection}
            selected={selected}
            names={names}
            places={prefs.group === 'worktree' ? null : places}
            now={loadedAt}
            onGroup={setSection}
            onSelect={select}
          />
        ) : null}
        <main className="flex min-w-0 flex-[999_1_480px] flex-col gap-3">{cardsBody}</main>
      </div>
    </div>
  )
}
