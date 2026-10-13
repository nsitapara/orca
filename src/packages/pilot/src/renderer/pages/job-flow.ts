import type { ActivityTick } from '../../shared/api-types'
import type { JobGroup } from '../../shared/job-stages'

export type FlowEdge = { from: number; to: number; caption: string | null }
export type JobActivityEntry = { tick: ActivityTick; stage: number; checkNames: string[] }

// The job page's arrows: each stage's feeds, by stage number, captioned with its hands_over. Display only.
export function flowEdges(job: JobGroup): FlowEdge[] {
  const stageOf = new Map(job.stages.map((s) => [s.id, s.job?.stage ?? 0]))
  return job.stages.flatMap((s) =>
    (s.job?.feeds ?? []).flatMap((target) => {
      const to = stageOf.get(target)
      if (to === undefined || !s.job) {
        return []
      }
      return [{ from: s.job.stage, to, caption: s.job.handsOver }]
    })
  )
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
