import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { getProjectHostSetupProjectionFromState } from '@/store/selectors'
import { pilotStore } from '../store'
import {
  buildActivityProjectChoices,
  buildProjectIdByRepoId,
  expandProjectRepoIds,
  type ActivityProjectChoices
} from './activity-project-scope'

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

/** One Projects row per project across machines; null until Pilot attaches. */
export function useActivityProjectChoices(
  filterRepoIds: readonly string[]
): ActivityProjectChoices | null {
  const repos = useAppStore((s) => s.repos)
  const projection = useAppStore((s) => getProjectHostSetupProjectionFromState(s))
  const attached = pilotStore() !== null
  return useMemo(() => {
    if (!attached) {
      return null
    }
    return buildActivityProjectChoices(
      repos,
      filterRepoIds,
      buildProjectIdByRepoId(repos, projection.setups)
    )
  }, [attached, filterRepoIds, repos, projection])
}
