import type { AutomationDefinition } from './types'

type Staged = AutomationDefinition & { job: NonNullable<AutomationDefinition['job']> }
// Automation id → why the job rules refuse it. Each problem is named on every definition it involves.
export type JobProblems = Map<string, string[]>

function staged(defs: readonly AutomationDefinition[]): Staged[] {
  return defs.filter((d): d is Staged => d.job !== null)
}

function add(problems: JobProblems, id: string, message: string): void {
  const list = problems.get(id) ?? []
  if (!list.includes(message)) {
    list.push(message)
  }
  problems.set(id, list)
}

function listed(ids: readonly string[]): string {
  if (ids.length === 2) {
    return `both ${ids[0]} and ${ids[1]}`
  }
  return `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`
}

function byJob(defs: readonly Staged[]): Map<string, Staged[]> {
  const jobs = new Map<string, Staged[]>()
  for (const d of defs) {
    jobs.set(d.job.id, [...(jobs.get(d.job.id) ?? []), d])
  }
  return jobs
}

function stageRule(jobId: string, members: readonly Staged[], problems: JobProblems): void {
  const stages = new Map<number, string[]>()
  for (const d of members) {
    stages.set(d.job.stage, [...(stages.get(d.job.stage) ?? []), d.id])
  }
  for (const [stage, ids] of stages) {
    if (ids.length > 1) {
      const message = `job ${jobId}: stage ${stage} is set by ${listed(ids)}`
      ids.forEach((id) => add(problems, id, message))
    }
  }
}

function nameRule(jobId: string, members: readonly Staged[], problems: JobProblems): void {
  const naming = members.filter((d) => d.job.name !== null)
  const names = [...new Set(naming.map((d) => d.job.name))]
  if (names.length === 0) {
    members.forEach((d) => add(problems, d.id, `job ${jobId}: no stage sets job.name`))
  } else if (names.length > 1) {
    const message = `job ${jobId}: its stages name it differently (${names.map((n) => JSON.stringify(n)).join(', ')})`
    naming.forEach((d) => add(problems, d.id, message))
  }
}

// Why a feeds target can't be drawn, or null when it can: it is loaded and a stage of the same job.
function unreachable(
  defs: readonly AutomationDefinition[],
  from: Staged,
  target: string
): string | null {
  const to = defs.find((d) => d.id === target)
  if (!to) {
    return `no automation "${target}"`
  }
  if (to.job === null) {
    return `${target} is in no job`
  }
  if (to.job.id !== from.job.id) {
    return `${target} is in job ${to.job.id}, not job ${from.job.id}`
  }
  return null
}

// Every cycle the same-job feeds edges make, each once, starting at its member that comes first in <defs>.
function cycles(defs: readonly Staged[]): string[][] {
  const order = new Map(defs.map((d, i) => [d.id, i]))
  const jobOf = new Map(defs.map((d) => [d.id, d.job.id]))
  const next = (id: string): string[] =>
    (defs.find((d) => d.id === id)?.job.feeds ?? []).filter(
      (t) => order.has(t) && jobOf.get(t) === jobOf.get(id)
    )
  const found = new Map<string, string[]>()
  const walk = (id: string, path: string[]): void => {
    const at = path.indexOf(id)
    if (at !== -1) {
      const loop = path.slice(at)
      const first = loop.reduce((a, b) => ((order.get(a) ?? 0) <= (order.get(b) ?? 0) ? a : b))
      const turned = [...loop.slice(loop.indexOf(first)), ...loop.slice(0, loop.indexOf(first))]
      found.set([...turned].sort().join('\n'), turned)
      return
    }
    next(id).forEach((t) => walk(t, [...path, id]))
  }
  defs.forEach((d) => walk(d.id, []))
  return [...found.values()]
}

// The rules a job's stages must keep across their files (the loader marks each involved definition invalid):
// a stage number once per job, one name, and no cycle in its feeds.
export function jobProblems(defs: readonly AutomationDefinition[]): JobProblems {
  const problems: JobProblems = new Map()
  const stagedDefs = staged(defs)
  for (const [jobId, members] of byJob(stagedDefs)) {
    stageRule(jobId, members, problems)
    nameRule(jobId, members, problems)
  }
  for (const loop of cycles(stagedDefs)) {
    const jobId = stagedDefs.find((d) => d.id === loop[0])?.job.id
    const message = `job ${jobId}: feeds go round in a cycle: ${[...loop, loop[0]].join(' → ')}`
    loop.forEach((id) => add(problems, id, message))
  }
  return problems
}

// feeds is display only, so a target that is missing (renamed), in no job or in another job only loses its arrow:
// a warning on the stage that names it, never a reason to stop that stage.
export function jobWarnings(defs: readonly AutomationDefinition[]): JobProblems {
  const warnings: JobProblems = new Map()
  for (const from of staged(defs)) {
    for (const target of from.job.feeds) {
      const why = unreachable(defs, from, target)
      if (why) {
        add(warnings, from.id, `job.feeds: ${why}; its arrow isn't drawn`)
      }
    }
  }
  return warnings
}
