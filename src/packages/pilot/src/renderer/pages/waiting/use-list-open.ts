import { useCallback, useState } from 'react'

function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== 'false'
  } catch {
    return true
  }
}

function write(key: string, open: boolean): void {
  try {
    window.localStorage.setItem(key, String(open))
  } catch {
    // Private windows and blocked storage: the choice just doesn't persist.
  }
}

// An open/folded choice remembered in storage under key, open the first time.
function useStoredOpen(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => read(key))
  const toggle = useCallback(() => {
    write(key, !open)
    setOpen(!open)
  }, [key, open])
  return [open, toggle]
}

// Whether the card list shows; remembered per viewer, open the first time.
export function useListOpen(): [boolean, () => void] {
  return useStoredOpen('pilot.inbox.listOpen')
}

// Whether the list's Kind section is unfolded.
export function useKindsOpen(): [boolean, () => void] {
  return useStoredOpen('pilot.inbox.kindsOpen')
}
