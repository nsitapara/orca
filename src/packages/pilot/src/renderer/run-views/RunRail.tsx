import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { StepRow } from '../../shared/api-types'
import type { ChainGroup, ChainPart } from '../../shared/run-views/chain'
import { isPainted, type PaintedPart } from '../../shared/run-views/paint'
import { formatDuration } from '../../shared/run/format-duration'
import { SourceLink } from './SourceLink'
import { STATE_CLASS, STATE_LABEL, STATE_MARK, WHO_CLASS, WHO_LABEL } from './tokens'

const GROUPS: readonly ChainGroup[] = ['before', 'steps', 'asks', 'after']
const GROUP_TITLE: Record<ChainGroup, string> = {
  before: 'Before any step',
  steps: 'Steps',
  asks: 'If it asks you',
  after: 'After the steps'
}

type Links = { onOpenRun?: (runId: string) => void; onOpenCard?: (cardId: string) => void }

function Tag({ children }: { children: string }): React.JSX.Element {
  return (
    <span className="rounded border border-border px-1 text-[10px] text-muted-foreground">
      {children}
    </span>
  )
}

function stepTime(step: StepRow | null): string | null {
  if (!step?.startedAt || !step.finishedAt) {
    return null
  }
  return formatDuration(step.finishedAt - step.startedAt)
}

function StateText({
  part,
  onOpenRun,
  onOpenCard
}: { part: PaintedPart } & Links): React.JSX.Element {
  const card = part.card
  const link = part.linkRunId
  const time = stepTime(part.step)
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      <span className={cn('rounded border border-border px-1.5', STATE_CLASS[part.state])}>
        {`${STATE_MARK[part.state]} ${STATE_LABEL[part.state]}`}
      </span>
      {time ? <span className="text-muted-foreground">{time}</span> : null}
      {part.detail ? <span className="break-all text-muted-foreground">{part.detail}</span> : null}
      {card && onOpenCard ? (
        <button type="button" className="underline" onClick={() => onOpenCard(card.id)}>
          Open card
        </button>
      ) : null}
      {link && onOpenRun ? (
        <button type="button" className="underline" onClick={() => onOpenRun(link)}>
          Open run
        </button>
      ) : null}
    </span>
  )
}

function RailRow({
  part,
  n,
  highlighted,
  onOpenRun,
  onOpenCard
}: { part: ChainPart; n: number | null; highlighted: boolean } & Links): React.JSX.Element {
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (highlighted) {
      ref.current?.scrollIntoView?.({ block: 'center' })
    }
  }, [highlighted])
  const painted = isPainted(part) ? part : null
  return (
    <li
      ref={ref}
      data-part={part.key}
      data-step-n={n ?? undefined}
      data-state={painted?.state}
      data-highlighted={highlighted ? '' : undefined}
      className={cn(
        'border-l-2 border-border py-1.5 pl-3',
        part.sub ? 'ml-5' : '',
        part.when ? 'border-dashed' : '',
        highlighted ? 'bg-accent/60' : ''
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {n !== null ? (
          <span className="w-5 text-right font-semibold tabular-nums text-muted-foreground">
            {n}
          </span>
        ) : null}
        <span className={cn('rounded border px-1.5 text-[11px]', WHO_CLASS[part.who])}>
          {WHO_LABEL[part.who]}
        </span>
        <span className="font-medium">{part.name}</span>
        {part.always ? <Tag>always</Tag> : null}
        <span className="flex-1" />
        {painted && painted.state !== 'none' ? (
          <StateText part={painted} onOpenRun={onOpenRun} onOpenCard={onOpenCard} />
        ) : null}
      </div>
      {part.runs ? (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 break-all font-mono text-xs text-muted-foreground">
            {part.runs}
          </div>
          <SourceLink part={part} />
        </div>
      ) : null}
      {part.when ? (
        <div className="break-all font-mono text-[11px] text-muted-foreground/80">
          <span className="mr-1 font-sans text-muted-foreground">only if</span>
          <span>{part.when}</span>
        </div>
      ) : null}
      {part.gives.length > 0 ? (
        <div className="text-xs text-muted-foreground">{`gives ${part.gives.join(', ')}`}</div>
      ) : null}
    </li>
  )
}

// Rows of parts, painted or not, with no group titles and no numbers: the run panel's "Before the steps" and its
// answers and hand-over rows.
export function RailRows({
  parts,
  highlight = null,
  onOpenRun,
  onOpenCard
}: {
  parts: readonly ChainPart[]
  highlight?: string | null
} & Links): React.JSX.Element {
  return (
    <ol className="flex flex-col">
      {parts.map((p) => (
        <RailRow
          key={p.key}
          part={p}
          n={null}
          highlighted={highlight === p.key}
          onOpenRun={onOpenRun}
          onOpenCard={onOpenCard}
        />
      ))}
    </ol>
  )
}

// An automation's plan (How it runs, spec §2 Rail): its parts in groups, each with who runs it and what it runs, the
// steps numbered in the order the YAML lists them, each condition on a line of its own. No run is painted on it: a run
// is shown by the run panel's timeline.
export function RunRail({ parts }: { parts: readonly ChainPart[] }): React.JSX.Element {
  const numbers = new Map(
    parts.filter((p) => p.group === 'steps').map((p, i) => [p.key, i + 1] as const)
  )
  return (
    <div className="flex flex-col gap-3">
      {GROUPS.map((g) => {
        const rows = parts.filter((p) => p.group === g)
        if (rows.length === 0) {
          return null
        }
        return (
          <section key={g} aria-label={GROUP_TITLE[g]}>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {g === 'steps' ? `${GROUP_TITLE[g]} · ${rows.length}` : GROUP_TITLE[g]}
            </h4>
            <ol className="mt-1 flex flex-col">
              {rows.map((p) => (
                <RailRow key={p.key} part={p} n={numbers.get(p.key) ?? null} highlighted={false} />
              ))}
            </ol>
          </section>
        )
      })}
    </div>
  )
}
