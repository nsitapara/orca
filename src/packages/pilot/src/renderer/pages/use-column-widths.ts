import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

// `align: 'right'` right-aligns a column of numbers, its header with it.
export type ColumnSpec = {
  id: string
  label: string
  defaultWidth: number
  minWidth: number
  align?: 'right'
}
type Widths = Record<string, number>

// Widths are remembered per viewer, by column id, so a changed set of checks keeps the others.
export const CHECKS_WIDTHS_KEY = 'pilot.activity.checksTable.widths'

function readStored(key: string): Widths {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null) {
      return {}
    }
    const out: Widths = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        out[id] = value
      }
    }
    return out
  } catch {
    return {}
  }
}

function writeStored(key: string, widths: Widths): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(widths))
  } catch {}
}

export function useColumnWidths(storageKey: string) {
  const [stored, setStored] = useState<Widths>(() => readStored(storageKey))
  const latest = useRef(stored)
  latest.current = stored
  const stopDrag = useRef<(() => void) | null>(null)
  useEffect(() => () => stopDrag.current?.(), [])

  const widthOf = (col: ColumnSpec): number =>
    Math.max(col.minWidth, stored[col.id] ?? col.defaultWidth)

  const commit = useCallback(
    (next: Widths) => {
      latest.current = next
      setStored(next)
      writeStored(storageKey, next)
    },
    [storageKey]
  )

  const startDrag = (col: ColumnSpec, event: ReactMouseEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = widthOf(col)
    const widthAt = (x: number) => Math.max(col.minWidth, Math.round(startWidth + x - startX))
    const onMove = (e: MouseEvent) => setStored({ ...latest.current, [col.id]: widthAt(e.clientX) })
    const detach = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      stopDrag.current = null
    }
    const onUp = (e: MouseEvent) => {
      detach()
      commit({ ...latest.current, [col.id]: widthAt(e.clientX) })
    }
    stopDrag.current?.()
    stopDrag.current = detach
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const reset = (col: ColumnSpec) => {
    const next = { ...latest.current }
    delete next[col.id]
    commit(next)
  }

  return { widthOf, startDrag, reset }
}
