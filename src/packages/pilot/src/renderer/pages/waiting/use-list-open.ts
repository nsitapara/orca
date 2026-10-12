import { useCallback, useState } from 'react'

const KEY = 'pilot.inbox.listOpen'

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'false'
  } catch {
    return true
  }
}

function write(open: boolean): void {
  try {
    window.localStorage.setItem(KEY, String(open))
  } catch {
    // Private windows and blocked storage: the choice just doesn't persist.
  }
}

// Whether the card list shows; remembered per viewer, open the first time.
export function useListOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(read)
  const toggle = useCallback(() => {
    setOpen((now) => {
      write(!now)
      return !now
    })
  }, [])
  return [open, toggle]
}
