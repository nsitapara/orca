import { KindChips, type KindFilterProps } from './KindFilter'

// The row under the header while the list is not beside the cards: the kind chips, then the view controls.
export function InboxFilters({
  controls,
  ...kinds
}: KindFilterProps & { controls: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <KindChips {...kinds} />
      <div className="ml-auto flex flex-wrap items-center gap-2">{controls}</div>
    </div>
  )
}
