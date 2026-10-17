import { describe, expect, it } from 'vitest'
import { callerStore, DEFINITIONS } from './__fixtures__/caller-store'
import { callerFolder } from './caller-folder'

const WT = '/wt/web-1577'
const MAIN = '/repos/web-platform'

function setup(present: string[], definitions = DEFINITIONS) {
  const s = callerStore()
  s.run('wt-run', 'review-branch-code', 'wt:repo::/wt/web-1577', WT, { 'worktree.path': WT })
  s.run('ci-run', 'fix-failed-ci', 'mr:1577', null, { 'mr.iid': 1577 })
  const there = new Set(present)
  const deps = {
    store: s.store,
    definitions: () => definitions,
    repoPath: (repo: string) => (repo === 'web-platform' ? MAIN : null),
    exists: (path: string) => there.has(path)
  }
  return { ...s, deps }
}

describe('the folder pilotcli acts in for an action', () => {
  it("is the card's worktree while its folder is there", () => {
    const { deps, card } = setup([WT, MAIN])
    const id = card('wt-run')
    expect(callerFolder(deps, { runId: 'wt-run', inboxItemId: id })).toBe(WT)
  })

  it("is the main checkout of the card's repo once the worktree folder is gone (it names the project only)", () => {
    const { deps, card } = setup([MAIN])
    const id = card('wt-run')
    expect(callerFolder(deps, { runId: 'wt-run', inboxItemId: id })).toBe(MAIN)
  })

  it("is a run's own worktree for the run's own attempt, else its repo's main checkout", () => {
    expect(callerFolder(setup([WT, MAIN]).deps, { runId: 'wt-run', inboxItemId: null })).toBe(WT)
    expect(callerFolder(setup([WT, MAIN]).deps, { runId: 'ci-run', inboxItemId: null })).toBe(MAIN)
  })

  it("is the main checkout of the one repo Pilot's automations name, for a call no card or run makes", () => {
    expect(callerFolder(setup([MAIN]).deps, { runId: null, inboxItemId: null })).toBe(MAIN)
  })

  it('is none when nothing names a folder that is there', () => {
    expect(callerFolder(setup([]).deps, { runId: 'wt-run', inboxItemId: null })).toBeNull()
    const two = [...DEFINITIONS, { ...DEFINITIONS[0], id: 'other', repo: 'pilot' }]
    expect(callerFolder(setup([MAIN], two).deps, { runId: null, inboxItemId: null })).toBeNull()
  })
})
