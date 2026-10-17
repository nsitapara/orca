import React, { createContext, useContext } from 'react'
import { LOCAL_PILOT_HOST, type PilotHostRef } from './pilot-host'

const PilotHostReactContext = createContext<PilotHostRef>(LOCAL_PILOT_HOST)

export function PilotHostProvider({
  host,
  children
}: {
  host: PilotHostRef
  children: React.ReactNode
}): React.JSX.Element {
  return <PilotHostReactContext.Provider value={host}>{children}</PilotHostReactContext.Provider>
}

export function usePilotHost(): PilotHostRef {
  return useContext(PilotHostReactContext)
}
