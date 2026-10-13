import { Fragment } from 'react'
import { ArrowRight } from 'lucide-react'
import type { AutomationDetailPayload, AutomationSummary } from '../../shared/api-types'
import { scheduleText } from './AutomationsTable'
import { lastTickText } from './format'
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

function facts(s: AutomationSummary, detail: AutomationDetailPayload | null, now: number) {
  const list: [string, string][] = [
    ['Schedule', scheduleText(s)],
    ['Last run', s.lastTick ? lastTickText(s.lastTick, now) : 'Never']
  ]
  if (s.powers.length) {
    list.push(['Can', s.powers.join(', ')])
  }
  if (detail?.checkNames.length) {
    list.push(['Needs', detail.checkNames.join(', ')])
  }
  list.push(['Status', s.enabled ? 'Enabled' : 'Paused'])
  return list
}

function StageCard({
  stage,
  now,
  onOpen
}: {
  stage: StageCardData
  now: number
  onOpen: (id: string) => void
}): React.JSX.Element {
  const s = stage.summary
  const description = stage.detail ? yamlDescription(stage.detail.yaml) : null
  return (
    <section className="flex min-w-[16rem] flex-1 flex-col gap-1.5 rounded-lg border border-border bg-muted/20 p-3">
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
      {description ? (
        <p className="truncate text-xs text-muted-foreground" title={description}>
          {description}
        </p>
      ) : null}
      <dl className="mt-1 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
        {facts(s, stage.detail, now).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function Arrow({ edge }: { edge: FlowEdge }): React.JSX.Element {
  return (
    <div
      role="img"
      aria-label={edgeName(edge)}
      className="flex flex-col items-center justify-center gap-1 px-1 text-muted-foreground"
    >
      <ArrowRight className="size-5" aria-hidden="true" />
      {edge.caption ? (
        <span className="max-w-[7rem] text-center text-[11px]">{edge.caption}</span>
      ) : null}
    </div>
  )
}

// The stages as cards in stage order. A feeds edge between neighbours is the arrow between their cards; any
// other edge (a stage feeding one further on, or back) is listed under them. Display only.
export function JobStageFlow({
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
      <div className="flex flex-wrap items-stretch gap-2">
        {stages.map((stage, i) => {
          const edge = between(i)
          return (
            <Fragment key={stage.summary.id}>
              <StageCard stage={stage} now={now} onOpen={onOpenStage} />
              {edge ? <Arrow edge={edge} /> : null}
            </Fragment>
          )
        })}
      </div>
      {others.map((e) => (
        <p
          key={`${e.from}-${e.to}`}
          role="img"
          aria-label={edgeName(e)}
          className="text-xs text-muted-foreground"
        >
          {`Stage ${e.from} → stage ${e.to}${e.caption ? ` · ${e.caption}` : ''}`}
        </p>
      ))}
    </div>
  )
}
