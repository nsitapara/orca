import { Fragment } from 'react'
import type { AutomationDetailPayload, AutomationSummary } from '../../shared/api-types'
import { lastHandoverText } from '../../shared/handover-text'
import { HowItRuns } from './HowItRuns'
import { yamlDescription, type FlowEdge } from './job-flow'

export type StageCardData = { summary: AutomationSummary; detail: AutomationDetailPayload | null }

function stageOf(s: AutomationSummary): number {
  return s.job?.stage ?? 0
}

function edgeName(edge: FlowEdge): string {
  if (edge.caption) {
    return `Stage ${edge.from} hands stage ${edge.to} ${edge.caption}`
  }
  return `Stage ${edge.from} feeds stage ${edge.to}`
}

// The row between two stage rails: what the first hands the next, and the most recent handover with how it went.
function HandoverRow({ edge, now }: { edge: FlowEdge; now: number }): React.JSX.Element {
  const what = edge.caption ? `Hands stage ${edge.to} ${edge.caption}` : `Feeds stage ${edge.to}`
  const last = lastHandoverText(edge.last, now)
  return (
    <div
      role="img"
      aria-label={edgeName(edge)}
      className="flex flex-wrap gap-x-3 pl-4 text-xs text-muted-foreground"
    >
      <span>{`↓ ${what}`}</span>
      {last ? <span>{last}</span> : null}
    </div>
  )
}

function StageRail({
  stage,
  onOpen
}: {
  stage: StageCardData
  onOpen: (id: string) => void
}): React.JSX.Element {
  const s = stage.summary
  const description = stage.detail ? yamlDescription(stage.detail.yaml) : null
  return (
    <section
      aria-label={`Stage ${stageOf(s)}`}
      className="flex flex-col gap-2 rounded-lg border border-border p-3"
    >
      <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        {`Stage ${stageOf(s)} · ${s.itemKind}`}
      </div>
      <button
        type="button"
        className="text-left text-sm font-medium hover:underline"
        onClick={() => onOpen(s.id)}
      >
        {s.job?.label ?? s.name}
      </button>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      <HowItRuns summary={s} />
    </section>
  )
}

// A job's stages: one rail per stage in stage order, joined by the handover its feeds draw. A feed that skips a
// stage or goes back is listed under them.
export function JobRails({
  stages,
  edges,
  now,
  onOpenStage
}: {
  stages: StageCardData[]
  edges: FlowEdge[]
  now: number
  onOpenStage: (id: string) => void
}): React.JSX.Element {
  const between = (i: number): FlowEdge | undefined => {
    const next = stages[i + 1]
    if (!next) {
      return undefined
    }
    const from = stageOf(stages[i].summary)
    return edges.find((e) => e.from === from && e.to === stageOf(next.summary))
  }
  const drawn = new Set(stages.map((_, i) => between(i)).filter((e) => e !== undefined))
  const others = edges.filter((e) => !drawn.has(e))
  return (
    <div className="flex flex-col gap-2">
      {stages.map((stage, i) => {
        const edge = between(i)
        return (
          <Fragment key={stage.summary.id}>
            <StageRail stage={stage} onOpen={onOpenStage} />
            {edge ? <HandoverRow edge={edge} now={now} /> : null}
          </Fragment>
        )
      })}
      {others.map((e) => (
        <p
          key={`${e.from}-${e.to}`}
          role="img"
          aria-label={edgeName(e)}
          className="text-xs text-muted-foreground"
        >
          {[`Stage ${e.from} → stage ${e.to}`, e.caption, lastHandoverText(e.last, now)]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ))}
    </div>
  )
}
