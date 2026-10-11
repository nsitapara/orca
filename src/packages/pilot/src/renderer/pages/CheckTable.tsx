import type { TickItemRow } from '../../shared/api-types'
import { verdictLabel } from './format'
import { CHECKS_WIDTHS_KEY, useColumnWidths, type ColumnSpec } from './use-column-widths'

const ITEM: ColumnSpec = { id: 'Item', defaultWidth: 200, minWidth: 100 }
const RESULT: ColumnSpec = { id: 'Result', defaultWidth: 260, minWidth: 140 }

function checkColumn(name: string): ColumnSpec {
  return { id: name, defaultWidth: 150, minWidth: 80 }
}

function CheckCell({ item, name }: { item: TickItemRow; name: string }): React.JSX.Element {
  const c = item.checks.find((x) => x.check === name)
  if (!c) {
    return <td className="break-words px-3 py-2 text-muted-foreground">—</td>
  }
  if (c.ok) {
    return <td className="break-words px-3 py-2 text-emerald-600">✓</td>
  }
  return <td className="break-words px-3 py-2 text-orange-600">{`✗ ${c.reason}`}</td>
}

function HeaderCell({
  col,
  columns
}: {
  col: ColumnSpec
  columns: ReturnType<typeof useColumnWidths>
}): React.JSX.Element {
  return (
    <th className="relative px-3 py-2 text-left font-medium">
      <span className="block truncate">{col.id}</span>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${col.id} column`}
        title="Drag to resize, double-click to reset"
        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-border"
        onMouseDown={(e) => columns.startDrag(col, e)}
        onDoubleClick={() => columns.reset(col)}
      />
    </th>
  )
}

export function CheckTable({
  items,
  checkNames
}: {
  items: TickItemRow[]
  checkNames: string[]
}): React.JSX.Element {
  const specs = [ITEM, ...checkNames.map(checkColumn), RESULT]
  const columns = useColumnWidths(CHECKS_WIDTHS_KEY)
  const total = specs.reduce((sum, col) => sum + columns.widthOf(col), 0)
  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-border/50 bg-muted/20">
      <table className="text-sm" style={{ tableLayout: 'fixed', width: total }}>
        <colgroup>
          {specs.map((col) => (
            <col key={col.id} style={{ width: columns.widthOf(col) }} />
          ))}
        </colgroup>
        <thead className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          <tr>
            {specs.map((col) => (
              <HeaderCell key={col.id} col={col} columns={columns} />
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.itemKey} className="border-t border-border/50 align-top">
              <td className="truncate px-3 py-2 font-medium" title={item.label}>
                {item.label}
              </td>
              {checkNames.map((name) => (
                <CheckCell key={name} item={item} name={name} />
              ))}
              <td className="px-3 py-2">
                <div>{verdictLabel(item.verdict)}</div>
                <div className="break-words text-xs text-muted-foreground">{item.reason}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
