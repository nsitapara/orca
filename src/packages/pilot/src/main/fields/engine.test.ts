import { describe, expect, it, vi } from 'vitest'
import { testDefinition } from '../../shared/definition/__fixtures__/definition'
import type { RepoFacts } from '../sources/types'
import { fakeFieldDeps, testItem } from './__fixtures__/field-deps'
import { addBuiltinFields } from './engine'
import type { WorktreeInfo } from './worktree-facts'

const repo: RepoFacts = { name: 'web-platform', id: 'r', path: '/repo', base: 'origin/dev' }
const worktrees: WorktreeInfo[] = [
  { id: 'r::/repo', path: '/repo', branch: 'dev', head: 'h0', linkedLinearIssue: null },
  { id: 'r::/wt/a', path: '/wt/a', branch: 'a', head: 'h1', linkedLinearIssue: null }
]
const def = testDefinition({ id: 'ci' })
const listed = { listWorktrees: async () => worktrees }

describe('addBuiltinFields', () => {
  it("gives every item the repo, both agents' quota and its waiting answers", async () => {
    const deps = fakeFieldDeps({
      ...listed,
      quotas: {
        claude: async () => ({ weekly: 61, session: 38 }),
        codex: async () => ({ weekly: 12, session: null })
      },
      pendingAnswers: (automationId, itemKey) =>
        automationId === 'ci' && itemKey === 'mr:1' ? 2 : 0
    })
    const [item] = await addBuiltinFields(
      def,
      [testItem({ key: 'mr:1', worktreeHint: { branch: 'a' } })],
      repo,
      deps
    )
    expect(item.fields).toMatchObject({
      'repo.name': 'web-platform',
      'repo.path': '/repo',
      'repo.base': 'origin/dev',
      'quota.claude.weekly_pct': 61,
      'quota.claude.session_pct': 38,
      'quota.codex.weekly_pct': 12,
      'quota.codex.session_pct': null,
      'inbox.pending_answers': 2,
      'worktree.path': '/wt/a',
      'worktree.head': 'h1'
    })
  })

  it('marks an item with no worktree as a known absence', async () => {
    const [item] = await addBuiltinFields(
      def,
      [testItem({ worktreeHint: { branch: 'gone' } })],
      repo,
      fakeFieldDeps(listed)
    )
    expect(item.fields).toMatchObject({
      'worktree.path': null,
      'session.open_from_automation': false,
      'session.open_any': false
    })
  })

  it('reads a worktree shared by two items once', async () => {
    const gitStatus = vi.fn(async () => ({ dirty: 0, untracked: 0 }))
    const items = [
      testItem({ key: 'mr:1', worktreeHint: { branch: 'a' } }),
      testItem({ key: 'mr:2', worktreeHint: { path: '/wt/a' } })
    ]
    await addBuiltinFields(def, items, repo, fakeFieldDeps({ ...listed, gitStatus }))
    expect(gitStatus).toHaveBeenCalledTimes(1)
  })

  it("describes the main checkout for a run-once automation's item", async () => {
    const runOnce = testDefinition({
      id: 'pull-dev',
      items: null,
      workspace: { kind: 'main_checkout' }
    })
    const [item] = await addBuiltinFields(
      runOnce,
      [testItem({ kind: 'repo', key: 'repo:web-platform' })],
      repo,
      fakeFieldDeps(listed)
    )
    expect(item.fields['worktree.path']).toBe('/repo')
  })

  it("keeps the waiting-answers count unknown when the queue can't be read", async () => {
    const deps = fakeFieldDeps({
      ...listed,
      pendingAnswers: () => {
        throw new Error('store closed')
      }
    })
    const [item] = await addBuiltinFields(def, [testItem()], repo, deps)
    expect(item.fields['inbox.pending_answers']).toBeNull()
  })

  it('leaves repo.base null when the repo has no base ref', async () => {
    const [item] = await addBuiltinFields(
      def,
      [testItem()],
      { ...repo, base: null },
      fakeFieldDeps(listed)
    )
    expect(item.fields['repo.base']).toBeNull()
  })

  it('fails when the worktree list fails, so the tick fails and the next one retries', async () => {
    const deps = fakeFieldDeps({
      listWorktrees: async () => {
        throw new Error('repo not found')
      }
    })
    await expect(addBuiltinFields(def, [testItem()], repo, deps)).rejects.toThrow('repo not found')
  })
})
