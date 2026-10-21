import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const KEPT_BRANCHES_RULES = '~/.agents/skills/worktree-gate/references/kept-branches.md'

// A branch an agent makes for its throwaway commits hides them from env delete, so job 15 never sees them
// (sources/kept-branches.ts). Every mode that may work in a throwaway commits on its detached HEAD by the shared rules.
describe('modes that may work in a throwaway', () => {
  it.each([
    ['review-cycles', 'answers'],
    ['ui-qa', 'answers'],
    ['ui-qa', 'fix'],
    ['global-command-address-mr-feedback', 'answers'],
    ['global-command-address-mr-feedback', 'feedback'],
    ['fix-gitlab-ci', 'answers'],
    ['fix-gitlab-ci', 'fix']
  ])('%s %s cites the kept-branch rules and makes no branch of its own', (skill, mode) => {
    const text = readFileSync(
      join(homedir(), '.agents', 'skills', skill, 'modes', `${mode}.md`),
      'utf8'
    )
    expect(text).toContain(KEPT_BRANCHES_RULES)
    expect(text).not.toMatch(/git branch -f pilot\//)
  })

  it('the rules exist and name the job that merges kept branches back', () => {
    const rules = readFileSync(KEPT_BRANCHES_RULES.replace(/^~/, homedir()), 'utf8')
    expect(rules).toContain('15 · Merge back kept fixes')
  })
})
