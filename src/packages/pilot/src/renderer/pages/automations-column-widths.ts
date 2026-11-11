import { MIN_COLUMN_WIDTH } from '@/components/github-project/column-widths'
import type { SortColumn } from './automations-sort'

// The columns a drag sizes, as fr weights; Status keeps a fixed width.
export type SizedColumn = Exclude<SortColumn, 'status'>
export type ColumnWidths = Record<SizedColumn, number>

export const SIZED_COLUMNS: readonly SizedColumn[] = ['name', 'schedule', 'nextTick', 'lastTick']
export const DEFAULT_WIDTHS: ColumnWidths = { name: 3, schedule: 1.25, nextTick: 1, lastTick: 1.75 }
const WIDTHS_KEY = 'pilot.automations.columnWidths'
const STATUS_WIDTH = '6rem'

// The grid minimum matches the resize handle's clamp, so a stored weight is what's drawn.
export function gridTemplate(widths: ColumnWidths): string {
  const sized = SIZED_COLUMNS.map((c) => `minmax(${MIN_COLUMN_WIDTH}px, ${widths[c]}fr)`)
  return [...sized, STATUS_WIDTH].join(' ')
}

type Pair = readonly [SizedColumn, SizedColumn]
const RESIZE_PAIRS = new Map<string, Pair>(
  SIZED_COLUMNS.slice(1).map((next, i): [string, Pair] => [
    SIZED_COLUMNS[i],
    [SIZED_COLUMNS[i], next]
  ])
)

// The pair a header's right edge sizes; null for the last sized column and for Status.
export function resizePair(column: string): Pair | null {
  return RESIZE_PAIRS.get(column) ?? null
}

export function resizeWidths(
  widths: ColumnWidths,
  column: string,
  width: number,
  next: string,
  nextWidth: number
): ColumnWidths {
  const at = (c: SizedColumn): number => {
    if (c === column) {
      return width
    }
    return c === next ? nextWidth : widths[c]
  }
  return {
    name: at('name'),
    schedule: at('schedule'),
    nextTick: at('nextTick'),
    lastTick: at('lastTick')
  }
}

function storedWidths(value: unknown): Partial<ColumnWidths> {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  const stored = new Map(Object.entries(value))
  const widths: Partial<ColumnWidths> = {}
  for (const c of SIZED_COLUMNS) {
    const w: unknown = stored.get(c)
    if (typeof w === 'number' && Number.isFinite(w) && w > 0) {
      widths[c] = w
    }
  }
  return widths
}

export function loadWidths(): ColumnWidths {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? 'null')
    return { ...DEFAULT_WIDTHS, ...storedWidths(parsed) }
  } catch {
    return DEFAULT_WIDTHS
  }
}

export function saveWidths(widths: ColumnWidths): void {
  try {
    localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths))
  } catch {
    // storage unavailable: the widths just aren't remembered
  }
}
