import type { AutomationSummary, TickRow } from './api-types'

// A job of several automations (their job: blocks share an id), its stages in stage order.
export type JobGroup<T extends AutomationSummary = AutomationSummary> = {
  kind: 'job'
  id: string
  name: string
  stages: T[]
}
export type ListEntry<T extends AutomationSummary = AutomationSummary> =
  | { kind: 'automation'; automation: T }
  | JobGroup<T>

function byStage(a: AutomationSummary, b: AutomationSummary): number {
  return (a.job?.stage ?? 0) - (b.job?.stage ?? 0)
}

// The name a stage sets (the loader refuses two that differ); with none loaded, the first stage's own name.
function jobName(stages: readonly AutomationSummary[]): string {
  return stages.find((s) => s.job?.name)?.job?.name ?? stages[0].name
}

function group<T extends AutomationSummary>(id: string, members: readonly T[]): JobGroup<T> {
  const stages = [...members].sort(byStage)
  return { kind: 'job', id, name: jobName(stages), stages }
}

// The list as the Automations page shows it: each job once, where its first automation is listed; an
// automation with no job: block is a row of its own, as before.
export function listEntries<T extends AutomationSummary>(
  automations: readonly T[]
): ListEntry<T>[] {
  const entries: ListEntry<T>[] = []
  const placed = new Set<string>()
  for (const a of automations) {
    if (!a.job) {
      entries.push({ kind: 'automation', automation: a })
      continue
    }
    const id = a.job.id
    if (!placed.has(id)) {
      placed.add(id)
      entries.push(
        group(
          id,
          automations.filter((x) => x.job?.id === id)
        )
      )
    }
  }
  return entries
}

// "13 · Fix red hourly e2e on dev": the job's heading, and its crumb on a stage's page.
export function jobTitle(job: JobGroup): string {
  return `${job.id} · ${job.name}`
}

export function findJob<T extends AutomationSummary>(
  automations: readonly T[],
  id: string
): JobGroup<T> | null {
  const members = automations.filter((a) => a.job?.id === id)
  return members.length ? group(id, members) : null
}

// On when any stage is.
export function jobEnabled(job: JobGroup): boolean {
  return job.stages.some((s) => s.enabled)
}

export function newestTick(list: readonly Pick<AutomationSummary, 'lastTick'>[]): TickRow | null {
  let newest: TickRow | null = null
  for (const s of list) {
    if (s.lastTick && (!newest || s.lastTick.startedAt > newest.startedAt)) {
      newest = s.lastTick
    }
  }
  return newest
}

// The newest tick of any stage, dry runs included (as each row's own last tick is).
export function jobLastTick(job: JobGroup): TickRow | null {
  return newestTick(job.stages)
}
