import { useEffect, useRef, useState } from 'react'

// Loads one image through <load> (it returns an object URL) when the component mounts, and revokes a
// blob: URL when it unmounts. <load> is read once: a new function on a re-render does not reload.
export function useImageUrl(load: () => Promise<string>): { url: string | null; failed: boolean } {
  const loadRef = useRef(load)
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({
    url: null,
    failed: false
  })
  useEffect(() => {
    let live = true
    let made: string | null = null
    loadRef.current().then(
      (url) => {
        made = url
        if (live) {
          setState({ url, failed: false })
        } else if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url)
        }
      },
      () => {
        if (live) {
          setState({ url: null, failed: true })
        }
      }
    )
    return () => {
      live = false
      if (made?.startsWith('blob:')) {
        URL.revokeObjectURL(made)
      }
    }
  }, [])
  return state
}
