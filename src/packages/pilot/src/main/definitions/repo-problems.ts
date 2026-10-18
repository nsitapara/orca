import type { AutomationDefinition } from '../../shared/definition/types'
import type { LoadedDefinitions } from './loader'

// A scheduled automation whose repo the runtime doesn't list (A4): recorded by the scheduler, shown
// beside parse errors while the repo stays unlisted.
export type RepoProblem = { file: string; repo: string; message: string }

export function mergeRepoProblems(
  loaded: LoadedDefinitions,
  problems: ReadonlyMap<string, RepoProblem>,
  isListed: (repo: string) => boolean,
  ticksHere: (def: AutomationDefinition) => boolean = () => true
): LoadedDefinitions {
  const extra: LoadedDefinitions['errors'] = []
  for (const [id, problem] of problems) {
    // Kept only while the current definition still has this problem: same repo, still scheduled here.
    const stillSo = loaded.definitions.some(
      (d) =>
        d.id === id &&
        d.repo === problem.repo &&
        d.enabled &&
        d.schedule !== 'manual' &&
        ticksHere(d)
    )
    if (stillSo && !isListed(problem.repo)) {
      extra.push({ file: problem.file, errors: [problem.message] })
    }
  }
  if (extra.length === 0) {
    return loaded
  }
  return { ...loaded, errors: [...loaded.errors, ...extra] }
}
