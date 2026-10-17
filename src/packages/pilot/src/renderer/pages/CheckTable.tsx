import type { ItemDecision } from '../../shared/api-types'
import { itemUrl, verdictLabel } from './format'
import { ResizableHeaderCell } from './ResizableHeaderCell'
import { CHECKS_WIDTHS_KEY, useColumnWidths, type ColumnSpec } from './use-column-widths'

// One checked item: a stored tick's item or a dry run's decision.
export type CheckRow = Pick<
  ItemDecision,
  'key' | 'label' | 'verdict' | 'reason' | 'checks' | 'fields'
>

const ITEM: ColumnSpec = { id: 'Item', label: 'Item', defaultWidth: 200, minWidth: 100 }
const RESULT: ColumnSpec = { id: 'Result', label: 'Result', defaultWidth: 260, minWidth: 140 }

function checkColumn(name: string): ColumnSpec {
  return { id: `check:${name}`, label: name, defaultWidth: 150, minWidth: 80 }
}

function CheckCell({ item, name }: { item: CheckRow; name: string }): React.JSX.Element {
  const c = item.checks.find((x) => x.check === name)
  if (!c) {
    return <td className="break-words px-3 py-2 text-muted-foreground">—</td>
  }
  if (c.ok) {
    return <td className="break-words px-3 py-2 text-emerald-600">✓</td>
  }
  return <td className="break-words px-3 py-2 text-orange-600">{`✗ ${c.reason}`}</td>
}

// The item's name, linked to its ticket, MR or pipeline when its source gives the page.
function ItemCell({ item }: { item: CheckRow }): React.JSX.Element {
  const url = itemUrl(item.fields)
  return (
    <td className="truncate px-3 py-2 font-medium" title={url ?? item.label}>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          {item.label}
        </a>
      ) : (
        item.label
      )}
    </td>
  )
}

// `dryRun`: the verdicts are what a tick would do.
export function CheckTable({
  items,
  checkNames,
  dryRun = false
}: {
  items: CheckRow[]
  checkNames: string[]
  dryRun?: boolean
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
              <ResizableHeaderCell key={col.id} col={col} columns={columns} />
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.key} className="border-t border-border/50 align-top">
              <ItemCell item={item} />
              {checkNames.map((name) => (
                <CheckCell key={name} item={item} name={name} />
              ))}
              <td className="px-3 py-2">
                <div>{verdictLabel(item.verdict, dryRun)}</div>
                <div className="break-words text-xs text-muted-foreground">{item.reason}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
