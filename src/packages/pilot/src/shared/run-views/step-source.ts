import type { SourceIndex, StepSource } from '../source-types'
import type { ChainPart } from './chain'

// The first `pilotcli <module> <verb-noun>` a step runs.
const PILOTCLI_COMMAND = /\bpilotcli\s+([a-z]+)\s+([a-z]+(?:-[a-z]+)*)\b/

// A step's code: an agent step's skill file, else the first pilotcli command it runs, when pilotcli says where that is.
export function stepSource(
  part: Pick<ChainPart, 'skill' | 'runs'>,
  index: SourceIndex
): StepSource | null {
  if (part.skill) {
    return { kind: 'file', path: `${index.skillsDir}/${part.skill}/SKILL.md` }
  }
  const command = PILOTCLI_COMMAND.exec(part.runs)
  const source = command ? index.pilotcli?.commands[`${command[1]} ${command[2]}`] : undefined
  if (!source || !index.pilotcli) {
    return null
  }
  return { kind: 'worktree', root: index.pilotcli.root, file: source.file, line: source.line }
}
