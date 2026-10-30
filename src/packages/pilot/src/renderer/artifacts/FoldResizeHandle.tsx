import { FOLD_MIN_HEIGHT, type useFoldResize } from './fold-resize'
import '../sidebar/sidebar-selection.css'
import './artifacts-fold.css'

type Resize = ReturnType<typeof useFoldResize>

/** The fold-out's top edge: drag it, or focus it and use the arrow keys; a double-click resets it. */
export function FoldResizeHandle({ resize }: { resize: Resize }): React.JSX.Element {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize artifacts"
      aria-valuemin={FOLD_MIN_HEIGHT}
      aria-valuenow={resize.height ?? undefined}
      title="Drag to resize · double-click to reset"
      tabIndex={0}
      data-dragging={resize.dragging || undefined}
      className="pilot-fold-grip absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize touch-none outline-none"
      {...resize.handle}
    />
  )
}
