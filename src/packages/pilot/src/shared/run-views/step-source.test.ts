import { describe, expect, it } from 'vitest'
import type { SourceIndex } from '../source-types'
import { stepSource } from './step-source'

const INDEX: SourceIndex = {
  pilotcli: {
    root: '/src/pilotCLI',
    commands: {
      'skills get-context': { file: 'internal/modules/skills/get_context.go', line: 42 },
      'git push-branch': { file: 'internal/modules/git/push_branch.go', line: 84 }
    }
  },
  skillsDir: '/home/.agents/skills'
}

describe('stepSource', () => {
  it.each([
    [
      "an agent step: its skill's SKILL.md",
      { skill: 'fix-gitlab-ci', runs: 'Claude · fix-gitlab-ci' },
      INDEX,
      { kind: 'file', path: '/home/.agents/skills/fix-gitlab-ci/SKILL.md' }
    ],
    [
      "a pilotcli step: its command's Run method",
      { skill: null, runs: 'pilotcli skills get-context fix-gitlab-ci "$IID"' },
      INDEX,
      {
        kind: 'worktree',
        root: '/src/pilotCLI',
        file: 'internal/modules/skills/get_context.go',
        line: 42
      }
    ],
    [
      'the first pilotcli command of a script',
      { skill: null, runs: 'cd "$W" && pilotcli git push-branch --checkout . && echo done' },
      INDEX,
      {
        kind: 'worktree',
        root: '/src/pilotCLI',
        file: 'internal/modules/git/push_branch.go',
        line: 84
      }
    ],
    [
      'a command pilotcli has no source for',
      { skill: null, runs: 'pilotcli env create' },
      INDEX,
      null
    ],
    [
      'a pilotcli without source_root',
      { skill: null, runs: 'pilotcli git push-branch' },
      { ...INDEX, pilotcli: null },
      null
    ],
    ['a script that is not pilotcli', { skill: null, runs: 'python3 sweep_envs.py' }, INDEX, null]
  ])('%s', (_name, part, index, want) => {
    expect(stepSource(part, index)).toEqual(want)
  })
})
