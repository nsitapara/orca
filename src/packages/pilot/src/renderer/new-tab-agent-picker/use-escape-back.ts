import { useEffect, useEffectEvent } from 'react'
import { isImeOwnedKeyboardEvent } from '@/lib/ime-composition-keyboard-event'

export function useEscapeBack(active: boolean, onBack: () => void): void {
  const back = useEffectEvent(onBack)
  useEffect(() => {
    if (!active) {
      return
    }
    // Why window capture: Radix closes the dialog from document capture unless the event is already prevented.
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || isImeOwnedKeyboardEvent(event)) {
        return
      }
      event.preventDefault()
      back()
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [active])
}
