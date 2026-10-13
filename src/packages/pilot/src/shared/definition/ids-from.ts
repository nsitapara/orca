import { splitArgv } from '../run/argv'
import { envNameProblem, runPlaceholders } from '../run/shell-template'
import type { IdsFrom } from './types'

export type IdsFromProblem = { key: 'run' | 'env'; message: string }

const NO_ITEM = 'ids_from runs before there is any item'

// What a loaded file can still get wrong in where.ids_from, beyond its shape: the shell-step rules (no Pilot
// placeholders, no reserved env names) plus argv only, since the command runs without a shell.
export function idsFromProblems(spec: Pick<IdsFrom, 'run' | 'env'>): IdsFromProblem[] {
  const problems: IdsFromProblem[] = []
  if (runPlaceholders(spec.run).length > 0) {
    problems.push({ key: 'run', message: `${NO_ITEM}, so it can't contain {placeholders}` })
  } else {
    const split = splitArgv(spec.run)
    if (!split.ok) {
      problems.push({ key: 'run', message: split.error })
    }
  }
  for (const [name, value] of Object.entries(spec.env ?? {})) {
    const problem = envNameProblem(name)
    if (problem) {
      problems.push({ key: 'env', message: problem })
    } else if (runPlaceholders(value).length > 0) {
      problems.push({ key: 'env', message: `${name}'s value is plain text here: ${NO_ITEM}` })
    }
  }
  return problems
}
