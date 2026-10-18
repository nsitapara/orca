import { useEffect, useEffectEvent } from 'react'
import { isEditableTarget } from '@/lib/editable-target'
import { hasVisibleOverlay } from '@/lib/visible-overlay'
import { useOpenRun } from '../../run-views/run-panel-state'

export type InboxFocusHandlers = {
  onNext: () => void
  onPrev: () => void
  onPick: (index: number) => void
  onSkip: () => void
  onExit: () => void
}

// InboxPage's root: the view buttons and filters sit outside the One at a time panel.
const INBOX_ROOT = '.pilot-inbox'

/** J/K, 1-9, S and Escape for the One at a time view, scoped to the Inbox page (or the bare page). */
export function useInboxFocusKeys(handlers: InboxFocusHandlers): void {
  const runOpen = useOpenRun() !== null
  const onKeyDown = useEffectEvent((event: KeyboardEvent): void => {
    const target = event.target instanceof Element ? event.target : null
    const inScope =
      target === document.body || (target !== null && target.closest(INBOX_ROOT) !== null)
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      !inScope ||
      isEditableTarget(target) ||
      hasVisibleOverlay()
    ) {
      return
    }
    const key = event.key.toLowerCase()
    if (/^[1-9]$/.test(key)) {
      handlers.onPick(Number(key) - 1)
    } else if (key === 'j') {
      handlers.onNext()
    } else if (key === 'k') {
      handlers.onPrev()
    } else if (key === 's') {
      handlers.onSkip()
    } else if (key === 'escape') {
      handlers.onExit()
    } else {
      return
    }
    event.preventDefault()
  })
  useEffect(() => {
    if (runOpen) {
      return
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [runOpen])
}
