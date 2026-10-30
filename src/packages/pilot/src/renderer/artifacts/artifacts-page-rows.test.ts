import { describe, expect, it } from 'vitest'
import {
  ARTIFACTS,
  CHILD_WT,
  FOLDER_WT,
  NOTES_PAGE,
  ORDERS,
  PARENT_WT,
  TOKEN_REPORT,
  UNTRACKED
} from '../../shared/__fixtures__/artifacts'
import { artifactsForWorktree, indexArtifactsByWorktree } from './artifacts-match'
import { resumeCommand } from './artifact-labels'
import { filterArtifacts, repoOfPath, repoOptions, tabCounts } from './artifacts-page-rows'

const NONE = new Map<string, string>()
const ids = (rows: { id: string }[]) => rows.map((a) => a.id)

describe('matching a worktree to its artifacts', () => {
  const index = indexArtifactsByWorktree(ARTIFACTS)

  it.each([
    ['a parent worktree', PARENT_WT, [ORDERS.id]],
    ['a child worktree that published to the same artifact', CHILD_WT, [ORDERS.id]],
    ['a path with a trailing slash', `${PARENT_WT}/`, [ORDERS.id]],
    ['a folder workspace', FOLDER_WT, [NOTES_PAGE.id]],
    ['a worktree with none', '/Users/dev/worktrees/web-platform/other', []],
    ['a prefix of a worktree', '/Users/dev/worktrees/web-platform', []],
    ['no path', null, []]
  ])('%s', (_name, path, expected) => {
    expect(ids([...artifactsForWorktree(index, path)])).toEqual(expected)
  })

  it('lists a worktree’s artifacts newest first', () => {
    const older = { ...ORDERS, id: 'older', last_published: '2026-10-01T00:00:00Z' }
    const index = indexArtifactsByWorktree([older, ORDERS])
    expect(ids([...artifactsForWorktree(index, PARENT_WT)])).toEqual([ORDERS.id, 'older'])
  })
})

describe('the page’s tabs', () => {
  it('counts each tab', () => {
    expect(tabCounts(ARTIFACTS)).toEqual({ agents: 2, local: 1, untracked: 1 })
  })

  const view = { query: '', repo: '', worktree: null }
  it.each([
    ['From agents', { ...view, tab: 'agents' as const }, [ORDERS.id, NOTES_PAGE.id]],
    ['Local reports', { ...view, tab: 'local' as const }, [TOKEN_REPORT.id]],
    ['Not tracked', { ...view, tab: 'untracked' as const }, [UNTRACKED.id]],
    ['a ticket search', { ...view, tab: 'agents' as const, query: 'web-2283' }, [ORDERS.id]],
    ['a branch search', { ...view, tab: 'agents' as const, query: 'REWORK-THE' }, [ORDERS.id]],
    ['a search with no match', { ...view, tab: 'agents' as const, query: 'nothing' }, []],
    [
      'a job search on reports',
      { ...view, tab: 'local' as const, query: 'tally' },
      [TOKEN_REPORT.id]
    ],
    ['a repo', { ...view, tab: 'agents' as const, repo: 'notes' }, [NOTES_PAGE.id]],
    [
      'a worktree',
      { ...view, tab: 'agents' as const, worktree: { path: CHILD_WT, label: 'web-2283' } },
      [ORDERS.id]
    ]
  ])('lists %s', (_name, v, expected) => {
    expect(ids(filterArtifacts(ARTIFACTS, v, NONE))).toEqual(expected)
  })

  it.each([
    ['a worktree under worktrees/<repo>', PARENT_WT, NONE, 'web-platform'],
    ['a main checkout', '/Users/dev/Documents/GitHub/pilotCLI', NONE, 'pilotCLI'],
    ['a path Orca knows', FOLDER_WT, new Map([[FOLDER_WT, 'Notes']]), 'Notes']
  ])('names the repo of %s', (_name, path, known, expected) => {
    expect(repoOfPath(path, known)).toBe(expected)
  })

  it('offers the agents’ repos, sorted', () => {
    expect(repoOptions(ARTIFACTS, NONE)).toEqual(['notes', 'web-platform'])
  })
})

describe('the resume command', () => {
  it.each([
    [
      'a session UUID',
      '0A1B2C3D-0000-4000-8000-000000000001',
      'claude --resume 0A1B2C3D-0000-4000-8000-000000000001'
    ],
    ['a command after a separator', 'x; rm -rf ~', null],
    ['no id', '', null],
    ['a command substitution', '$(id)', null],
    ['a UUID with a command after it', '0a1b2c3d-0000-4000-8000-000000000001 && id', null]
  ])('is built for %s only when it is a UUID', (_name, id, expected) => {
    expect(resumeCommand(id)).toBe(expected)
  })
})
