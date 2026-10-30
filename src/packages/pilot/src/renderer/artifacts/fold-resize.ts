import { useEffect, useRef, useState } from 'react'
import { setArtifactsFoldHeight, useArtifactsFoldHeight } from './artifacts-view'

export const FOLD_MIN_HEIGHT = 76
// The worktree list keeps at least the rest of the sidebar.
export const FOLD_MAX_SHARE = 0.7
export const FOLD_STEP = 16

export function clampFoldHeight(height: number, sidebarHeight: number): number {
  const max = Math.max(FOLD_MIN_HEIGHT, Math.floor(sidebarHeight * FOLD_MAX_SHARE))
  return Math.round(Math.min(max, Math.max(FOLD_MIN_HEIGHT, height)))
}

type Drag = {
  startY: number
  startHeight: number
  cursor: string
  userSelect: string
}

/**
 * The fold-out's height, dragged from its top edge or nudged with the arrow keys, clamped to the
 * sidebar (its parent). The pointer is captured, so a drag over the terminal or a webview keeps going.
 * Persisted on release; a double-click goes back to the default size.
 */
export function useFoldResize(section: React.RefObject<HTMLElement | null>) {
  const stored = useArtifactsFoldHeight()
  const [draft, setDraft] = useState<number | null>(null)
  const drag = useRef<Drag | null>(null)
  const draftRef = useRef<number | null>(null)

  const clampToSidebar = (height: number): number =>
    clampFoldHeight(height, section.current?.parentElement?.clientHeight ?? 0)
  const shownHeight = (): number =>
    draftRef.current ?? stored ?? section.current?.getBoundingClientRect().height ?? 0
  const update = (height: number): void => {
    draftRef.current = height
    setDraft(height)
  }
  const end = (): void => {
    const session = drag.current
    if (!session) {
      return
    }
    drag.current = null
    document.body.style.cursor = session.cursor
    document.body.style.userSelect = session.userSelect
    if (draftRef.current !== null) {
      setArtifactsFoldHeight(draftRef.current)
    }
    draftRef.current = null
    setDraft(null)
  }

  // Unmounted mid-drag (the worktree changed): give the page its cursor back.
  useEffect(
    () => () => {
      const session = drag.current
      if (session) {
        document.body.style.cursor = session.cursor
        document.body.style.userSelect = session.userSelect
      }
    },
    []
  )

  const handle = {
    onPointerDown(event: React.PointerEvent<HTMLElement>): void {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      const startHeight = shownHeight()
      drag.current = {
        startY: event.clientY,
        startHeight,
        cursor: document.body.style.cursor,
        userSelect: document.body.style.userSelect
      }
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
      update(clampToSidebar(startHeight))
    },
    onPointerMove(event: React.PointerEvent<HTMLElement>): void {
      const session = drag.current
      if (session) {
        update(clampToSidebar(session.startHeight + session.startY - event.clientY))
      }
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
    onKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
        return
      }
      event.preventDefault()
      const step = event.key === 'ArrowUp' ? FOLD_STEP : -FOLD_STEP
      setArtifactsFoldHeight(clampToSidebar(shownHeight() + step))
    },
    onDoubleClick(): void {
      setArtifactsFoldHeight(null)
    }
  }
  return { height: draft ?? stored, dragging: draft !== null, handle }
}
