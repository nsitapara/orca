import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { InboxItemSummary } from '../../shared/api-types'
import { checkoutRemoved, homeOf } from '../../shared/api-types-env'
import type { ActivityRun } from '../../shared/api-types-runs'
import { money } from '../../shared/money'
import type { PaintedPart } from '../../shared/run-views/paint'
import { runTimeline, type RanStep } from '../../shared/run-views/timeline'
import { formatDuration } from '../../shared/run/format-duration'
import { clockSeconds, runStatusLabel } from '../pages/format'
import { stepTabOf } from '../../shared/run-views/step-tab'
import { RailRows } from './RunRail'
import { useShowTab } from './ShowTab'
import { StepDetail } from './StepDetail'
import { STATE_CLASS, STATE_LABEL, STATE_MARK, WHO_CLASS, WHO_LABEL } from './tokens'

type Links = { onOpenRun?: (runId: string) => void; onOpenCard?: (cardId: string) => void }

const OUTPUT_MAX = 24
const OUTPUTS_SHOWN = 3
// A closed card that never mattered (replaced, stale, dismissed) isn't shown under its step.
const SHOWN_CARD: readonly InboxItemSummary['status'][] = ['open', 'answered', 'done']
const DOT_CLASS: Record<PaintedPart['who'], string> = {
  pilot: 'border-border text-muted-foreground',
  script: 'border-sky-500/50 text-sky-700 dark:text-sky-300',
  agent: 'border-violet-500/50 text-violet-700 dark:text-violet-300',
  you: 'border-amber-500/70 text-amber-700 dark:text-amber-300'
}

function cardWord(card: InboxItemSummary): string {
  if (card.status !== 'open') {
    return 'You answered'
  }
  if (card.type === 'default') {
    return 'Took a default'
  }
  if (card.type === 'question') {
    return 'Asked you'
  }
  if (card.type === 'left_for_you') {
    return 'Left for you'
  }
  return 'For you'
}

// Only what waits on Nish is amber: an open card that isn't a default.
function waitsOnYou(card: InboxItemSummary): boolean {
  return card.status === 'open' && card.type !== 'default'
}

// "lead = codex": a step's short one-line outputs, a few at most.
function outputsLine(part: PaintedPart): string[] {
  return Object.entries(part.step?.outputs ?? {})
    .map(([k, v]) => [k, String(v)] as const)
    .filter(([, v]) => v.length <= OUTPUT_MAX && !v.includes('\n'))
    .slice(0, OUTPUTS_SHOWN)
    .map(([k, v]) => `${k} = ${v}`)
}

function whoText(part: PaintedPart): string {
  if (part.who === 'agent' && part.runs) {
    return part.runs
  }
  return WHO_LABEL[part.who]
}

function CardNote({
  card,
  onOpenCard
}: {
  card: InboxItemSummary
  onOpenCard?: (cardId: string) => void
}): React.JSX.Element {
  const amber = waitsOnYou(card)
  return (
    <div
      className={cn(
        'flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-r border-l-2 px-2 py-1 text-xs',
        amber ? 'border-amber-500/70 bg-amber-500/10' : 'border-border bg-muted/50'
      )}
    >
      <span
        className={cn(
          'font-semibold',
          amber ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'
        )}
      >
        {cardWord(card)}
      </span>
      <span className="min-w-0 break-words">{card.title}</span>
      {onOpenCard ? (
        <button type="button" className="underline" onClick={() => onOpenCard(card.id)}>
          Open card
        </button>
      ) : null}
    </div>
  )
}

function StepRowView({
  ran,
  run,
  last,
  highlighted,
  onOpenCard
}: {
  ran: RanStep
  run: ActivityRun
  last: boolean
  highlighted: boolean
} & Links): React.JSX.Element {
  const { n, part } = ran
  const step = part.step
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (highlighted) {
      ref.current?.scrollIntoView?.({ block: 'center' })
    }
  }, [highlighted])
  const took =
    step?.startedAt && step.finishedAt ? formatDuration(step.finishedAt - step.startedAt) : null
  const show = useShowTab(step ? stepTabOf(step, run.worktreePath) : undefined)
  const failed = part.state === 'failed' && step?.error ? step.error : null
  return (
    <li
      ref={ref}
      data-part={part.key}
      data-step-n={n}
      data-state={part.state}
      data-highlighted={highlighted ? '' : undefined}
      className={cn(
        'grid grid-cols-[4.75rem_1.75rem_minmax(0,1fr)] gap-x-2',
        highlighted ? 'rounded bg-accent/60' : ''
      )}
    >
      <span className="pt-1 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {step?.startedAt ? clockSeconds(step.startedAt) : ''}
      </span>
      <span className="relative flex justify-center">
        {last ? null : (
          <span className="absolute bottom-0 top-6 w-0.5 bg-border" aria-hidden="true" />
        )}
        <span
          className={cn(
            'relative grid size-6 place-items-center rounded-full border-2 bg-background text-xs font-bold tabular-nums',
            DOT_CLASS[part.who]
          )}
        >
          {n}
        </span>
      </span>
      <div className="flex min-w-0 flex-col gap-1 pb-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {step ? (
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
          <span className={cn('rounded border px-1.5 text-[11px]', WHO_CLASS[part.who])}>
            {whoText(part)}
          </span>
          <span
            className={cn('rounded border border-border px-1.5 text-xs', STATE_CLASS[part.state])}
          >
            {`${STATE_MARK[part.state]} ${STATE_LABEL[part.state]}`}
          </span>
          {show.control ? <span className="text-xs">{show.control}</span> : null}
        </div>
        <div className="flex flex-wrap gap-x-3 text-xs tabular-nums text-muted-foreground">
          {took ? <span>{took}</span> : null}
          {step?.costUsd !== null && step?.costUsd !== undefined ? (
            <span>{money(step.costUsd)}</span>
          ) : null}
          {outputsLine(part).map((o) => (
            <span key={o}>{o}</span>
          ))}
        </div>
        {show.note ? <p className="text-xs text-muted-foreground">{show.note}</p> : null}
        {failed ? (
          <div className="rounded-r border-l-2 border-destructive/60 bg-destructive/10 px-2 py-1 text-xs">
            {failed}
          </div>
        ) : null}
        {part.cards
          .filter((c) => SHOWN_CARD.includes(c.status))
          .map((card) => (
            <CardNote key={card.id} card={card} onOpenCard={onOpenCard} />
          ))}
        {open && step ? (
          <StepDetail
            runId={run.id}
            worktreePath={homeOf(run)}
            checkoutRemoved={checkoutRemoved(run)}
            step={step}
          />
        ) : null}
      </div>
    </li>
  )
}

function RunEnd({ run }: { run: ActivityRun }): React.JSX.Element | null {
  if (run.finishedAt === null) {
    return null
  }
  return (
    <li className="grid grid-cols-[4.75rem_1.75rem_minmax(0,1fr)] gap-x-2">
      <span className="pt-1 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {clockSeconds(run.finishedAt)}
      </span>
      <span className="flex justify-center">
        <span className="grid size-6 place-items-center rounded-full border-2 border-border bg-background text-[10px]">
          ■
        </span>
      </span>
      <div className="flex min-w-0 flex-wrap items-baseline gap-2 pb-2 text-sm">
        <span className="font-medium">{`Run ${runStatusLabel(run.status).toLowerCase()}`}</span>
        {run.outcome ? <span className="text-xs text-muted-foreground">{run.outcome}</span> : null}
      </div>
    </li>
  )
}

function beforeSummary(parts: readonly PaintedPart[]): { text: string; mark: string } {
  const bad = parts.find(
    (p) => p.state === 'failed' || p.state === 'asking' || p.state === 'running'
  )
  if (bad) {
    return { text: `${bad.name}: ${STATE_LABEL[bad.state]}`, mark: STATE_MARK[bad.state] }
  }
  const shown = parts.filter((p) => p.state !== 'none')
  return { text: shown.map((p) => p.name).join(' · '), mark: shown.length > 0 ? '✓' : '' }
}

// One run as a timeline (the run panel): what happened before the steps, folded to a line; the steps that ran, numbered
// in the order they started, each with its time, how long it took, what it cost, what it gave and the cards it left;
// how the run ended; the steps that didn't run, grouped by why; then the answers and hand-over rows.
export function RunTimeline({
  parts,
  run,
  highlight = null,
  drifted = false,
  onOpenRun,
  onOpenCard
}: {
  parts: readonly PaintedPart[]
  run: ActivityRun
  highlight?: string | null
  drifted?: boolean
} & Links): React.JSX.Element {
  const timeline = runTimeline(parts, run)
  const before = parts.filter((p) => p.group === 'before')
  const after = parts.filter((p) => p.group !== 'before' && p.kind !== 'step' && p.state !== 'none')
  const summary = beforeSummary(before)
  const beforeOpen =
    before.some((p) => p.state === 'failed' || p.state === 'asking') ||
    before.some((p) => p.key === highlight)
  return (
    <div className="flex flex-col gap-3">
      {drifted ? (
        <p className="text-xs text-muted-foreground">The YAML has changed since this run</p>
      ) : null}
      {before.length > 0 ? (
        <details open={beforeOpen} className="rounded border border-border bg-muted/30">
          <summary className="cursor-pointer px-3 py-1.5 text-xs">
            <span className="font-semibold">Before the steps</span>
            <span className="ml-2 text-muted-foreground">{`${summary.mark} ${summary.text}`}</span>
          </summary>
          <div className="px-3 pb-2">
            <RailRows
              parts={before}
              highlight={highlight}
              onOpenRun={onOpenRun}
              onOpenCard={onOpenCard}
            />
          </div>
        </details>
      ) : null}
      {timeline.ran.length > 0 || run.finishedAt !== null ? (
        <ol aria-label="Steps that ran" className="flex flex-col">
          {timeline.ran.map((ran, i) => (
            <StepRowView
              key={ran.part.key}
              ran={ran}
              run={run}
              last={i === timeline.ran.length - 1 && run.finishedAt === null}
              highlighted={highlight === ran.part.key}
              onOpenCard={onOpenCard}
            />
          ))}
          <RunEnd run={run} />
        </ol>
      ) : null}
      {timeline.notRun.length > 0 ? (
        <section
          aria-label="Didn't run"
          className="flex flex-col gap-1.5 border-t border-dashed border-border pt-2"
        >
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {`Didn't run · ${timeline.notRun.reduce((n, g) => n + g.parts.length, 0)}`}
          </h4>
          {timeline.notRun.map((group) => (
            <div
              key={group.reason}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs"
            >
              <span className="text-muted-foreground">{group.reason}</span>
              <span className="flex flex-wrap gap-1">
                {group.parts.map((p) => (
                  <span
                    key={p.key}
                    data-part={p.key}
                    title={p.when ? `only if ${p.when}` : p.runs}
                    className="rounded border border-dashed border-border px-1.5 font-mono text-muted-foreground"
                  >
                    {p.name}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </section>
      ) : null}
      {after.length > 0 ? (
        <RailRows
          parts={after}
          highlight={highlight}
          onOpenRun={onOpenRun}
          onOpenCard={onOpenCard}
        />
      ) : null}
    </div>
  )
}
