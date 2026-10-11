import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseModeFile, type ModeFile } from '../../shared/run/mode-file'
import type { AgentStepDeps } from './agent-step'

export type ModeDoc = ModeFile & { skill: string; mode: string; file: string }

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// Where agents find a skill: the workspace's own (.claude/skills, .agents/skills), then Nish's store
// (~/.agents/skills) and the agent folders that link into it (~/.claude/skills, ~/.codex/skills).
export function skillSearchDirs(workspacePath: string | null, home: string = homedir()): string[] {
  const own = workspacePath
    ? [join(workspacePath, '.claude', 'skills'), join(workspacePath, '.agents', 'skills')]
    : []
  return [
    ...own,
    join(home, '.agents', 'skills'),
    join(home, '.claude', 'skills'),
    join(home, '.codex', 'skills')
  ]
}

function missingFile(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

// The first <dir>/<skill>/modes/<mode>.md in skillSearchDirs order. Throws, naming every path it
// tried, when there is none; and when the file is there but its frontmatter is wrong.
export function readMode(
  skill: string,
  mode: string,
  workspacePath: string | null,
  home?: string
): ModeDoc {
  if (!NAME.test(skill) || !NAME.test(mode)) {
    throw new Error(
      `Mode "${mode}" of skill "${skill}": names may use letters, digits, ., _ and - only`
    )
  }
  const tried: string[] = []
  for (const dir of skillSearchDirs(workspacePath, home)) {
    const file = join(dir, skill, 'modes', `${mode}.md`)
    tried.push(file)
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (error) {
      if (missingFile(error)) {
        continue
      }
      throw new Error(
        `Can't read ${file}: ${(error as NodeJS.ErrnoException).code ?? String(error)}`
      )
    }
    const parsed = parseModeFile(text, file)
    if (!parsed.ok) {
      throw new Error(parsed.error)
    }
    return { ...parsed.mode, skill, mode, file }
  }
  throw new Error(
    `Mode "${mode}" of skill "${skill}" not found; looked in:\n${tried.map((t) => `  ${t}`).join('\n')}`
  )
}

// The mode body a wrapped prompt carries (contract §7), as launchAgentStep asks for it with the
// workspace it launches in. A raw prompt carries none. A mode that can't be found rejects, so the
// step fails before an agent starts with half its instructions.
export function modeTextFor(
  read: (skill: string, mode: string, workspacePath: string | null) => { body: string }
): AgentStepDeps['modeText'] {
  return async (step, workspacePath) => {
    if (!step.mode || step.promptStyle === 'raw') {
      return null
    }
    if (!step.skill) {
      throw new Error(`Step ${step.name}: mode "${step.mode}" needs a skill`)
    }
    return read(step.skill, step.mode, workspacePath).body
  }
}
