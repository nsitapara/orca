import { createContext } from 'react'

/** The Group by group a row is listed in, from ActivityTabsNest; null outside Pilot's nested groups. */
export const ActivityRowGroupContext = createContext<string | null>(null)
