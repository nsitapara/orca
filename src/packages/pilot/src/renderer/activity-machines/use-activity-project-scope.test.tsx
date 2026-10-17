// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { useWorktreeTabsContext } from '../activity-tabs/use-worktree-tabs-context'
import { registerPilotStore } from '../store'
import { PROJECT_REPOS, attach } from './activity-machines-test-fixtures'
import { useActivityProjectChoices, useActivityProjectRepoIds } from './use-activity-project-scope'

beforeEach(() => {
  useAppStore.setState({
    repos: PROJECT_REPOS,
    projects: [],
    projectHostSetups: [],
    agentsFilterRepoIds: ['a-local']
  })
})

afterEach(() => {
  cleanup()
  registerPilotStore(null)
})

it('returns its input untouched until Pilot attaches', () => {
  const ids = ['a-local']
  expect(renderHook(() => useActivityProjectRepoIds(ids)).result.current).toBe(ids)
})

it('adds the other machines’ copies once Pilot attaches', () => {
  attach()
  expect(renderHook(() => useActivityProjectRepoIds(['a-local'])).result.current).toEqual([
    'a-local',
    'a-mini'
  ])
})

it('keeps its result while the filter and repos stay the same', () => {
  attach()
  const ids = ['a-local']
  const { result, rerender } = renderHook(() => useActivityProjectRepoIds(ids))
  const first = result.current
  rerender()
  expect(result.current).toBe(first)
})

it('keeps the other machine’s tabs under a project filter', () => {
  attach()
  expect(
    renderHook(() => useWorktreeTabsContext('', [])).result.current.scope.filterRepoIds
  ).toEqual(['a-local', 'a-mini'])
})

it('offers no choices until Pilot attaches', () => {
  expect(renderHook(() => useActivityProjectChoices([])).result.current).toBeNull()
})

it('selects a project from any machine’s copy', () => {
  attach()
  expect(
    renderHook(() => useActivityProjectChoices(['a-mini'])).result.current?.selected.map(
      (r) => r.id
    )
  ).toEqual(['a-local'])
})
