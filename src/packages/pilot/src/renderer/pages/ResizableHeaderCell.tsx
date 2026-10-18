import type { ColumnSpec, useColumnWidths } from './use-column-widths'

// A column header whose right edge drags to resize the column and double-clicks back to its default.
export function ResizableHeaderCell({
  col,
  columns
}: {
  col: ColumnSpec
  columns: ReturnType<typeof useColumnWidths>
}): React.JSX.Element {
  return (
    <th
      className={
        col.align === 'right'
          ? 'relative px-3 py-2 text-right font-medium'
          : 'relative px-3 py-2 text-left font-medium'
      }
    >
      <span className="block truncate">{col.label}</span>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${col.label} column`}
        title="Drag to resize, double-click to reset"
        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-border"
        onMouseDown={(e) => columns.startDrag(col, e)}
        onDoubleClick={() => columns.reset(col)}
      />
    </th>
  )
}
