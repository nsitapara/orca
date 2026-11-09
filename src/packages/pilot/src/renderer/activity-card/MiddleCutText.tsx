import { useLayoutEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { fitMiddleCut } from './middle-cut'

/**
 * Text that, when it doesn't fit, drops words from its middle and keeps its start and its last
 * `tail` words, so both ends stay readable. `lines` 2 wraps before cutting. The full text is its
 * tooltip.
 */
export function MiddleCutText({
  text,
  tail,
  separator = ' ',
  lines = 1,
  className,
  ...rest
}: {
  text: string
  tail: number
  separator?: ' ' | '-'
  lines?: 1 | 2
  className?: string
} & Omit<React.HTMLAttributes<HTMLSpanElement>, 'children' | 'title'>): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }
    const fit = () => fitMiddleCut(element, text, tail, separator)
    fit()
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    // Why: the sidebar's width changes; a cut made for the old width would leave space or overflow.
    let width = element.clientWidth
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== width) {
        width = element.clientWidth
        fit()
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [text, tail, separator])
  // Children stay empty: the layout effect owns the text, so React never fights the cut.
  return (
    <span
      ref={ref}
      title={text}
      className={cn(lines === 2 ? 'line-clamp-2 break-words' : 'truncate', className)}
      {...rest}
    />
  )
}
