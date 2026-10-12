import { cn } from '@/lib/utils'
import type { InboxItemRow } from '../../../shared/api-types'
import type { Section } from '../../../shared/inbox-groups'
import { ageLabel, jobCode, KIND_LABEL } from './answer-text'
import { kindChipClass } from './chips'
import { ALL } from './InboxHeader'

// The left list: the same sections, in the same order, as the cards.
export function CardList({
  sections,
  total,
  group,
  selected,
  names,
  now,
  onGroup,
  onSelect
}: {
  sections: Section[]
  total: number
  group: string
  selected: string | null
  names: Map<string, string>
  now: number
  onGroup: (key: string) => void
  onSelect: (item: InboxItemRow) => void
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
        <div key={s.group.key} className="flex flex-col gap-0.5">
          <button
            type="button"
            aria-pressed={group === s.group.key}
            title={s.group.label}
            onClick={() => onGroup(s.group.key)}
            className={cn(
              'truncate px-2 pt-2.5 pb-1 text-left font-mono text-[11.5px] font-semibold hover:text-foreground',
              group === s.group.key ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {s.group.label} · {s.items.length}
          </button>
          {s.items.map((i) => (
            <button
              key={i.id}
              type="button"
              data-row={i.id}
              aria-current={selected === i.id ? 'true' : undefined}
              onClick={() => onSelect(i)}
              className={cn(
                'flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left',
                selected === i.id ? 'bg-muted' : 'hover:bg-muted/50'
              )}
            >
              <span className="flex items-center gap-1.5">
                <span className={kindChipClass(i.type, true)}>{KIND_LABEL[i.type]}</span>
                <span className="flex-1 text-[11.5px] text-muted-foreground">
                  {jobCode(names.get(i.automationId) ?? i.automationId, i.automationId)}
                </span>
                <span className="text-[11.5px] text-muted-foreground">
                  {ageLabel(i.createdAt, now)}
                </span>
              </span>
              <span className="line-clamp-2 text-[13px] leading-snug font-semibold">{i.title}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}
