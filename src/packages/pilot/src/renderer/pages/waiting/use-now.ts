import { useEffect, useState } from 'react'

// The time, ticking each second while `active` (a countdown is on screen) and still otherwise.
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) {
      return undefined
    }
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}
