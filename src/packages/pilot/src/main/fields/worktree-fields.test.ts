import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addWorktreeFields, detectGitOperation, type FactDeps } from './worktree-fields'

const item = (key: string, branch: string) => ({
  key,
  label: key,
  fields: { 'mr.branch': branch, 'mr.pipeline': 1 }
})

const deps: FactDeps = {
  listWorktrees: async () => [
    { id: 'repo::/wt/a', path: '/wt/a', branch: 'a' },
    { id: 'repo::/wt/b', path: '/wt/b', branch: 'b' }
  ],
  gitStatusCount: async (path) => (path === '/wt/b' ? 2 : 0),
  gitOperation: async () => null,
  openSessionHandles: (_automation, path) => (path === '/wt/a' ? ['term_1'] : []),
  terminalAlive: async (handle) => handle === 'term_1'
}

const boom = async (): Promise<never> => {
  throw new Error('boom')
}

describe('addWorktreeFields', () => {
  it('fills worktree and session fields for items that need facts', async () => {
    const out = await addWorktreeFields(
      [item('!1', 'a'), item('!2', 'b'), item('!3', 'missing')],
      'ci',
      '/repo',
      deps,
      () => true
    )
    expect(
      out.map((i) => [
        i.key,
        i.fields['worktree.path'],
        i.fields['worktree.dirty_count'],
        i.fields['session.open_from_automation']
      ])
    ).toEqual([
      ['!1', '/wt/a', 0, true],
      ['!2', '/wt/b', 2, false],
      ['!3', null, null, false]
    ])
    expect(out[0].fields['worktree.id']).toBe('repo::/wt/a')
  })

  it('skips git work for items that do not need facts', async () => {
    const out = await addWorktreeFields([item('!1', 'a')], 'ci', '/repo', deps, () => false)
    expect(out[0].fields['worktree.dirty_count']).toBeUndefined()
  })

  it('leaves the dirty count null when git status fails', async () => {
    const out = await addWorktreeFields(
      [item('!1', 'a')],
      'ci',
      '/repo',
      { ...deps, gitStatusCount: boom },
      () => true
    )
    expect(out[0].fields['worktree.dirty_count']).toBeNull()
    expect(out[0].fields['worktree.path']).toBe('/wt/a')
  })

  it('leaves the git operation absent when it cannot be read', async () => {
    const out = await addWorktreeFields(
      [item('!1', 'a')],
      'ci',
      '/repo',
      { ...deps, gitOperation: boom },
      () => true
    )
    expect(out[0].fields).not.toHaveProperty('worktree.git_operation')
  })

  it('leaves the open-session fact absent when the store cannot be read', async () => {
    const broken: FactDeps = {
      ...deps,
      openSessionHandles: () => {
        throw new Error('store closed')
      }
    }
    const out = await addWorktreeFields([item('!1', 'a')], 'ci', '/repo', broken, () => true)
    expect(out[0].fields).not.toHaveProperty('session.open_from_automation')
  })

  it('throws when the worktree list fails, so the tick fails and the next one retries', async () => {
    await expect(
      addWorktreeFields(
        [item('!1', 'a')],
        'ci',
        '/repo',
        { ...deps, listWorktrees: boom },
        () => true
      )
    ).rejects.toThrow('boom')
  })

  it('leaves the open-session fact absent when a terminal check errors and none is alive', async () => {
    const flaky: FactDeps = {
      ...deps,
      openSessionHandles: () => ['t1', 't2'],
      terminalAlive: async (h) => (h === 't1' ? boom() : false)
    }
    const out = await addWorktreeFields([item('!1', 'a')], 'ci', '/repo', flaky, () => true)
    expect(out[0].fields).not.toHaveProperty('session.open_from_automation')
  })
})

describe('detectGitOperation', () => {
  it.each([
    ['MERGE_HEAD', 'merge'],
    ['rebase-merge', 'rebase'],
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['sequencer', 'cherry-pick or revert'],
    ['rebase-apply', 'rebase'],
    ['rebase-apply/applying', 'am'],
    ['index.lock', 'git operation (index.lock)']
  ])('%s → %s', (marker, expected) => {
    const gitDir = mkdtempSync(join(tmpdir(), 'pilot-gitdir-'))
    if (marker.includes('/')) {
      mkdirSync(join(gitDir, marker.split('/')[0]))
      writeFileSync(join(gitDir, marker), '')
    } else if (['rebase-merge', 'rebase-apply', 'sequencer'].includes(marker)) {
      mkdirSync(join(gitDir, marker))
    } else {
      writeFileSync(join(gitDir, marker), '')
    }
    expect(detectGitOperation(gitDir)).toBe(expected)
  })

  it('is null for a quiet git dir', () => {
    expect(detectGitOperation(mkdtempSync(join(tmpdir(), 'pilot-gitdir-')))).toBeNull()
  })
})
