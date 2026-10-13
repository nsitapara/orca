import { cn } from '@/lib/utils'
import type { Section } from './sections'
import { toggleSection } from './section-filter'

// One on/off pill per section, in bundle order.
export function SectionBar({
  sections,
  off
}: {
  sections: Section[]
  off: ReadonlySet<string>
}): React.JSX.Element {
  return (
    <div role="toolbar" aria-label="Show sections" className="flex flex-wrap gap-1.5">
      {sections.map((s) => {
        const on = !off.has(s.key)
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={on}
            onClick={() => toggleSection(s.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12.5px]',
              on
                ? 'border-[var(--ib-accent)] bg-[var(--ib-accent-soft)] font-semibold text-foreground'
                : 'border-border text-muted-foreground'
            )}
          >
            <span
              aria-hidden
              className={cn(
                'size-[7px] rounded-full border',
                on ? 'border-transparent bg-[var(--ib-accent)]' : 'border-muted-foreground'
              )}
            />
            {s.label}
            {s.count ? <span className="font-normal text-muted-foreground">{s.count}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
