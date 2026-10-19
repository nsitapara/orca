import { describe, expect, it } from 'vitest'
import type { HostedSection } from '../../hosts/hosted-sections'
import { LOCAL_PILOT_HOST } from '../../hosts/pilot-host'
import { groupByProject, projectOf } from './inbox-projects'

function section(key: string, label = key): HostedSection {
  return { key, host: LOCAL_PILOT_HOST, group: { key, label, rank: 0 }, items: [] }
}

const KNOWN: Record<string, string> = { '/r/web/a': 'web-platform', '/r/pilot/b': 'pilot' }
const repoName = (path: string): string | null => KNOWN[path] ?? null

describe('projectOf', () => {
  it.each([
    ['the app’s project name', 'wt:/r/web/a', 'web-platform'],
    [
      'the parent folder of a worktree the app does not list',
      'wt:/wt/web-platform/web-99',
      'web-platform'
    ],
    ['the parent folder of a Windows path', 'wt:C:\\wt\\pilot\\fix\\', 'pilot'],
    ['no project for an MR', 'mr:1579', null],
    ['no project for a job', 'job:tests', null]
  ])('%s', (_case, key, expected) => {
    expect(projectOf(section(key), repoName)).toBe(expected)
  })
})

describe('groupByProject', () => {
  const nameOf = (s: HostedSection) => projectOf(s, repoName)

  it('keeps a project’s worktrees together where its first one was, and puts the sections with none last', () => {
    const sections = [
      section('wt:/r/web/a'),
      section('mr:1579'),
      section('wt:/r/pilot/b'),
      section('wt:/wt/web-platform/c'),
      section('job:tests')
    ]
    expect(
      groupByProject(sections, nameOf).map((p) => [p.name, p.sections.map((s) => s.key)])
    ).toEqual([
      ['web-platform', ['wt:/r/web/a', 'wt:/wt/web-platform/c']],
      ['pilot', ['wt:/r/pilot/b']],
      [null, ['mr:1579', 'job:tests']]
    ])
  })

  it('makes no project for no sections', () => {
    expect(groupByProject([], nameOf)).toEqual([])
  })
})
