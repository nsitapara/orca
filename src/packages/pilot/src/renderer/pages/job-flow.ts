import type { ActivityTick, HandoverRow } from '../../shared/api-types'
import type { JobGroup } from '../../shared/job-stages'

// `last`: the rows of the most recent handover along the edge ([] when none, or the feed passes no ids).
export type FlowEdge = { from: number; to: number; caption: string | null; last: HandoverRow[] }
export type LatestHandover = (from: string, to: string) => HandoverRow[]
export type JobActivityEntry = { tick: ActivityTick; stage: number; checkNames: string[] }

// The job page's arrows: each stage's feeds connections, by stage number, each with its caption and the most recent
// handover along it.
export function flowEdges(job: JobGroup, latest: LatestHandover = () => []): FlowEdge[] {
  const stageOf = new Map(job.stages.map((s) => [s.id, s.job?.stage ?? 0]))
  return job.stages.flatMap((s) =>
    (s.job?.feeds ?? []).flatMap((feed) => {
      const to = stageOf.get(feed.to)
      if (to === undefined || !s.job) {
        return []
      }
      return [{ from: s.job.stage, to, caption: feed.caption, last: latest(s.id, feed.to) }]
    })
  )
}

// The latest handovers the stages' detail payloads carry (pilot.automations.get), by sender and receiver.
export function latestFrom(
  details: readonly ({
    summary: { id: string }
    handovers?: { to: string; rows: HandoverRow[] }[]
  } | null)[]
): LatestHandover {
  return (from, to) =>
    details.find((d) => d?.summary.id === from)?.handovers?.find((h) => h.to === to)?.rows ?? []
}

// One timeline for the job: every stage's ticks, newest first (the tick id breaks a tie), each with its stage.
export function mergeJobActivity(
  stages: readonly { stage: number; checkNames: string[]; ticks: readonly ActivityTick[] }[]
): JobActivityEntry[] {
  return stages
    .flatMap((s) => s.ticks.map((tick) => ({ tick, stage: s.stage, checkNames: s.checkNames })))
    .sort((a, b) => b.tick.startedAt - a.tick.startedAt || b.tick.id - a.tick.id)
}

// The first words of the comment the YAML file opens with, or null when it opens with none.
export function yamlDescription(yaml: string): string | null {
  for (const line of yaml.split('\n')) {
    const text = line.trim()
    if (text === '') {
      continue
    }
    if (!text.startsWith('#')) {
      return null
    }
    const said = text.replace(/^#+/, '').trim()
    if (said !== '') {
      return said
    }
  }
  return null
}
