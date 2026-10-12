import { useCallback, useRef, useState } from 'react'

// The width of an element, measured on the element itself (not the window): the Inbox shares its window with
// Pilot's own sidebar. Null until measured, and where ResizeObserver does not exist.
export function useElementWidth(): [(el: HTMLElement | null) => void, number | null] {
  const [width, setWidth] = useState<number | null>(null)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el || typeof ResizeObserver === 'undefined') {
      return
    }
    observer.current = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w !== undefined) {
        setWidth(Math.round(w))
      }
    })
    observer.current.observe(el)
  }, [])
  return [ref, width]
}
