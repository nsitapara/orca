import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { getProjectHostSetupProjectionFromState } from '@/store/selectors'
import { pilotStore } from '../store'
import { buildProjectIdByRepoId, expandProjectRepoIds } from './activity-project-scope'

/** Widens Activity's Projects filter to every machine's copy; the input untouched until Pilot attaches. */
export function useActivityProjectRepoIds(filterRepoIds: readonly string[]): readonly string[] {
  const repos = useAppStore((s) => s.repos)
  const projection = useAppStore((s) => getProjectHostSetupProjectionFromState(s))
  const attached = pilotStore() !== null
  return useMemo(() => {
    if (!attached || filterRepoIds.length === 0) {
      return filterRepoIds
    }
    return expandProjectRepoIds(
      filterRepoIds,
      repos,
      buildProjectIdByRepoId(repos, projection.setups)
    )
  }, [attached, filterRepoIds, repos, projection])
}
