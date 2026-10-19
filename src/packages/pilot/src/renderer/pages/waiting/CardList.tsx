import { ChevronDown, GitBranch } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { InboxListRow } from '../../../shared/api-types'
import type { HostedSection } from '../../hosts/hosted-sections'
import { MachineChip } from '../../hosts/MachineChip'
import { hostedKey, hostOf, type Hosted } from '../../hosts/pilot-host'
import { ageLabel } from './answer-text'
import { cardCount, NO_PROJECT_NAME, type ProjectSections } from './inbox-projects'
import { ALL } from './InboxHeader'
import { isWorktreeGroup, OpenWorktreeButton } from './WorktreeLink'

type RowProps = {
  group: string
  // The picked card's hostedKey.
  selected: string | null
  names: Map<string, string>
  // By hostedKey, the card's "project / worktree" to name on its row; null while the sections are worktrees.
  places: ReadonlyMap<string, string> | null
  now: number
  onGroup: (key: string) => void
  onSelect: (item: Hosted<InboxListRow>) => void
}

// A section's heading stays pinned while its cards scroll under it, so no half-cut line shows at the list's top edge.
// Under a project, it pins below the project's heading and its cards hang off a guide line from the branch icon.
function ListSection({
  section: s,
  nested,
  group,
  selected,
  names,
  places,
  now,
  onGroup,
  onSelect
}: RowProps & { section: HostedSection; nested: boolean }): React.JSX.Element {
  return (
    <div className="flex flex-col pb-1.5">
      {/* Group by Nothing's one section has no label, so no heading to pick it by. */}
      {s.group.label ? (
        <div
          className={cn(
            'sticky z-[1] flex h-[30px] shrink-0 items-center gap-1 bg-background pr-1.5',
            nested ? 'top-8 pl-5' : 'top-0 pl-2'
          )}
        >
          {isWorktreeGroup(s.group) ? (
            <GitBranch aria-hidden className="size-3 shrink-0 text-muted-foreground" />
          ) : null}
          <button
            type="button"
            aria-pressed={group === s.key}
            title={s.group.label}
            onClick={() => onGroup(s.key)}
            className={cn(
              'flex min-w-0 flex-1 px-1 text-left font-mono text-[11.5px] font-semibold hover:text-foreground',
              group === s.key ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            <span className="truncate">{s.group.label}</span>
            <span className="shrink-0 whitespace-pre"> · {s.items.length}</span>
          </button>
          <OpenWorktreeButton group={s.group} host={s.host} />
          {/* A card cut off under the pinned heading fades out instead of showing half a line. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-full h-3 bg-gradient-to-b from-background to-transparent"
          />
        </div>
      ) : null}
      <ul
        className={cn(
          'flex flex-col gap-0.5',
          nested ? 'ml-[26px] border-l border-border pr-1.5 pl-1.5' : 'px-1.5'
        )}
      >
        {s.items.map((i) => {
          const key = hostedKey(i.host, i.id)
          const place = places?.get(key)
          const job = names.get(i.automationId) ?? i.automationId
          const current = selected === key
          return (
            <li key={key} className="relative">
              {current && nested ? (
                <span
                  aria-hidden
                  className="absolute top-2 bottom-2 -left-2 w-[3px] rounded-full bg-[var(--ib-accent)]"
                />
              ) : null}
              <button
                type="button"
                data-row={key}
                aria-current={current ? 'true' : undefined}
                onClick={() => onSelect(i)}
                className={cn(
                  'flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left',
                  current ? 'bg-muted' : 'hover:bg-muted/50'
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  <span title={job} className="min-w-0 flex-1 truncate">
                    {job}
                  </span>
                  <span className="shrink-0">{ageLabel(i.createdAt, now)}</span>
                  <MachineChip host={hostOf(i)} />
                </span>
                <span className="line-clamp-2 text-[13px] leading-snug font-semibold">
                  {i.title}
                </span>
                {place && place !== s.group.label ? (
                  <span
                    title={place}
                    className="truncate font-mono text-[11px] text-muted-foreground"
                  >
                    {place}
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// A project's band, pinned above its worktrees; it folds them away in the list (the cards stay).
function ProjectGroup({
  project,
  folded,
  onFold,
  children
}: {
  project: ProjectSections
  folded: boolean
  onFold: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const name = project.name ?? NO_PROJECT_NAME
  const count = cardCount(project)
  return (
    <div role="group" aria-label={name} className="flex flex-col">
      <button
        type="button"
        aria-expanded={!folded}
        aria-label={`${name} · ${count}`}
        title={folded ? 'Show its worktrees' : 'Fold its worktrees'}
        onClick={onFold}
        className="sticky top-0 z-10 flex h-8 shrink-0 items-center gap-1.5 border-b border-border bg-muted px-2 text-left text-[12.5px] font-semibold text-foreground"
      >
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
            folded && '-rotate-90'
          )}
        />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="shrink-0 rounded-full bg-background px-1.5 font-mono text-[11px] text-muted-foreground">
          {count}
        </span>
      </button>
      {folded ? null : children}
    </div>
  )
}

// The left list: the same sections, in the same order, as the cards; under Group by Worktree, inside their projects.
export function CardList({
  sections,
  projects,
  total,
  ...rows
}: RowProps & {
  sections: HostedSection[]
  projects: ProjectSections[] | null
  total: number
}): React.JSX.Element {
  // Project keys folded in the list.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const fold = (key: string) =>
    setFolded((now) => {
      const next = new Set(now)
      if (!next.delete(key)) {
        next.add(key)
      }
      return next
    })
  return (
    <nav
      aria-label="Cards"
      className="sticky top-3 z-20 flex max-h-[calc(100vh-6rem)] min-w-0 flex-[0_1_270px] flex-col self-start overflow-y-auto rounded-lg border border-border bg-background scrollbar-sleek"
    >
      <button
        type="button"
        aria-pressed={rows.group === ALL}
        onClick={() => rows.onGroup(ALL)}
        className={cn(
          'shrink-0 border-b border-border px-3 py-2 text-left font-mono text-[11.5px] font-semibold hover:text-foreground',
          rows.group === ALL ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        All · {total}
      </button>
      {projects
        ? projects.map((p) => (
            <ProjectGroup
              key={p.key}
              project={p}
              folded={folded.has(p.key)}
              onFold={() => fold(p.key)}
            >
              {p.sections.map((s) => (
                <ListSection key={s.key} section={s} nested {...rows} />
              ))}
            </ProjectGroup>
          ))
        : sections.map((s) => <ListSection key={s.key} section={s} nested={false} {...rows} />)}
    </nav>
  )
}
