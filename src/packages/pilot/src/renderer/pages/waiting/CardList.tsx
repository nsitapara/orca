import { cn } from '@/lib/utils'
import type { InboxListRow } from '../../../shared/api-types'
import type { HostedSection } from '../../hosts/hosted-sections'
import { MachineChip } from '../../hosts/MachineChip'
import { hostedKey, hostOf, type Hosted } from '../../hosts/pilot-host'
import { ageLabel, jobCode } from './answer-text'
import { ALL } from './InboxHeader'
import { OpenWorktreeButton } from './WorktreeLink'

// The left list: the same sections, in the same order, as the cards.
export function CardList({
  sections,
  total,
  group,
  selected,
  names,
  places,
  now,
  onGroup,
  onSelect
}: {
  sections: HostedSection[]
  total: number
  group: string
  // The picked card's hostedKey.
  selected: string | null
  names: Map<string, string>
  // By hostedKey, the card's Worktree heading to name on its row; null while the sections are worktrees.
  places: ReadonlyMap<string, string> | null
  now: number
  onGroup: (key: string) => void
  onSelect: (item: Hosted<InboxListRow>) => void
}): React.JSX.Element {
  return (
    <nav
      aria-label="Cards"
      className="sticky top-3 z-20 flex max-h-[calc(100vh-6rem)] min-w-0 flex-[0_1_250px] flex-col gap-0.5 self-start overflow-y-auto bg-background scrollbar-sleek"
    >
      <button
        type="button"
        aria-pressed={group === ALL}
        onClick={() => onGroup(ALL)}
        className={cn(
          'truncate px-2 pt-1 pb-1 text-left font-mono text-[11.5px] font-semibold hover:text-foreground',
          group === ALL ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        All · {total}
      </button>
      {sections.map((s) => (
        <div key={s.key} className="flex flex-col gap-0.5">
          {/* Group by Nothing's one section has no label, so no heading to pick it by. */}
          {s.group.label ? (
            <div className="flex items-center gap-1 pt-2.5 pb-1 pr-1">
              <button
                type="button"
                aria-pressed={group === s.key}
                title={s.group.label}
                onClick={() => onGroup(s.key)}
                className={cn(
                  'truncate min-w-0 flex-1 px-2 text-left font-mono text-[11.5px] font-semibold hover:text-foreground',
                  group === s.key ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {s.group.label} · {s.items.length}
              </button>
              <OpenWorktreeButton group={s.group} host={s.host} />
            </div>
          ) : null}
          {s.items.map((i) => {
            const key = hostedKey(i.host, i.id)
            const place = places?.get(key)
            return (
              <button
                key={key}
                type="button"
                data-row={key}
                aria-current={selected === key ? 'true' : undefined}
                onClick={() => onSelect(i)}
                className={cn(
                  'flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left',
                  selected === key ? 'bg-muted' : 'hover:bg-muted/50'
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span className="flex-1 text-[11.5px] text-muted-foreground">
                    {jobCode(names.get(i.automationId) ?? i.automationId, i.automationId)}
                  </span>
                  <span className="text-[11.5px] text-muted-foreground">
                    {ageLabel(i.createdAt, now)}
                  </span>
                  <MachineChip host={hostOf(i)} />
                </span>
                <span className="line-clamp-2 text-[13px] leading-snug font-semibold">
                  {i.title}
                </span>
                {place && place !== s.group.label ? (
                  <span
                    title={place}
                    className="truncate font-mono text-[11.5px] text-muted-foreground"
                  >
                    {place}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
