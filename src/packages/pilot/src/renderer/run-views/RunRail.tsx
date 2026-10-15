import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { StepRow } from '../../shared/api-types'
import { checkoutRemoved, homeOf } from '../../shared/api-types-env'
import type { ActivityRun } from '../../shared/api-types-runs'
import type { ChainGroup, ChainPart } from '../../shared/run-views/chain'
import { isPainted, type PaintedPart } from '../../shared/run-views/paint'
import { formatDuration } from '../../shared/run/format-duration'
import { StepDetail } from './StepDetail'
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
  run,
  highlighted,
  onOpenRun,
  onOpenCard
}: { part: ChainPart; run: ActivityRun | null; highlighted: boolean } & Links): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (highlighted) {
      ref.current?.scrollIntoView?.({ block: 'center' })
    }
  }, [highlighted])
  const painted = isPainted(part) ? part : null
  const step = painted?.step ?? null
  return (
    <li
      ref={ref}
      data-part={part.key}
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
        <span className={cn('rounded border px-1.5 text-[11px]', WHO_CLASS[part.who])}>
          {WHO_LABEL[part.who]}
        </span>
        {step && run ? (
          <button
            type="button"
            aria-expanded={open}
            className="font-medium hover:underline"
            onClick={() => setOpen(!open)}
          >
            {part.name}
          </button>
        ) : (
          <span className="font-medium">{part.name}</span>
        )}
        {part.always ? <Tag>always</Tag> : null}
        {part.when ? <Tag>{`when ${part.when}`}</Tag> : null}
        <span className="flex-1" />
        {painted && painted.state !== 'none' ? (
          <StateText part={painted} onOpenRun={onOpenRun} onOpenCard={onOpenCard} />
        ) : null}
      </div>
      {part.runs ? (
        <div className="break-all font-mono text-xs text-muted-foreground">{part.runs}</div>
      ) : null}
      {part.gives.length > 0 ? (
        <div className="text-xs text-muted-foreground">{`gives ${part.gives.join(', ')}`}</div>
      ) : null}
      {open && step && run ? (
        <StepDetail
          runId={run.id}
          worktreePath={homeOf(run)}
          checkoutRemoved={checkoutRemoved(run)}
          step={step}
        />
      ) : null}
    </li>
  )
}

// The chain as rows (spec §2 Rail), grouped, each with who runs it and what it runs; with a run, each part's state, and a
// step row expands to what it stored. `highlight` names the part a link opened the rail at.
export function RunRail({
  parts,
  run,
  highlight = null,
  drifted = false,
  onOpenRun,
  onOpenCard
}: {
  parts: readonly ChainPart[]
  run: ActivityRun | null
  highlight?: string | null
  drifted?: boolean
} & Links): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {drifted ? (
        <p className="text-xs text-muted-foreground">The YAML has changed since this run</p>
      ) : null}
      {GROUPS.map((g) => {
        const rows = parts.filter((p) => p.group === g)
        if (rows.length === 0) {
          return null
        }
        return (
          <section key={g} aria-label={GROUP_TITLE[g]}>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {GROUP_TITLE[g]}
            </h4>
            <ol className="mt-1 flex flex-col">
              {rows.map((p) => (
                <RailRow
                  key={p.key}
                  part={p}
                  run={run}
                  highlighted={highlight === p.key}
                  onOpenRun={onOpenRun}
                  onOpenCard={onOpenCard}
                />
              ))}
            </ol>
          </section>
        )
      })}
    </div>
  )
}
