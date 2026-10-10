// The slice of Orca's app store that Pilot reads. Pilot's renderer behavior stays inert until
// attachPilotRenderer() registers the real store, so upstream tests and unattached runs see pure upstream behavior.
export type PilotStore = {
  getState(): { rightSidebarOpen: boolean; setRightSidebarOpen(open: boolean): void }
}

let registered: PilotStore | null = null

export function registerPilotStore(store: PilotStore | null): void {
  registered = store
}

export function pilotStore(): PilotStore | null {
  return registered
}
