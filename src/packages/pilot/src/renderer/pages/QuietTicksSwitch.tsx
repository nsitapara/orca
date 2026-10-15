import { useState } from 'react'
import { SwitchIndicator } from '@/components/ui/switch'

const SHOW_QUIET_KEY = 'pilot.activity.showQuiet'

// Activity leaves out the ticks that had nothing to do (pilot.automations.activity's skipQuiet) unless the viewer
// turned that off; the choice is remembered for every automation and job page.
function loadHideQuiet(): boolean {
  try {
    return localStorage.getItem(SHOW_QUIET_KEY) !== '1'
  } catch {
    return true
  }
}

function saveHideQuiet(hide: boolean): void {
  try {
    if (hide) {
      localStorage.removeItem(SHOW_QUIET_KEY)
    } else {
      localStorage.setItem(SHOW_QUIET_KEY, '1')
    }
  } catch {
    // storage unavailable: the choice just isn't remembered
  }
}

export function useHideQuiet(): [boolean, (hide: boolean) => void] {
  const [hide, setHide] = useState(loadHideQuiet)
  const choose = (next: boolean): void => {
    saveHideQuiet(next)
    setHide(next)
  }
  return [hide, choose]
}

export function emptyActivityText(hideQuiet: boolean): string {
  return hideQuiet ? 'No ticks with anything to do yet.' : 'No ticks yet.'
}

export function QuietTicksSwitch({
  hide,
  onChange
}: {
  hide: boolean
  onChange: (hide: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={hide}
      onClick={() => onChange(!hide)}
      className="ml-auto flex items-center gap-2 pb-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <SwitchIndicator checked={hide} size="compact" />
      Hide ticks with nothing to do
    </button>
  )
}
