import { create } from 'zustand'
import { pilotStore } from '../store'

// Pilot's own flag: upstream's activeModal union has no picker id.
export const useNewTabAgentPickerOpen = create<{ open: boolean }>(() => ({ open: false }))

export function setNewTabAgentPickerOpen(open: boolean): void {
  useNewTabAgentPickerOpen.setState({ open })
}

/** Opens the picker once Pilot is attached; false leaves the caller on its bare-terminal path. */
export function openNewTabAgentPicker(): boolean {
  if (!pilotStore()) {
    return false
  }
  setNewTabAgentPickerOpen(true)
  return true
}

export function openNewTabAgentPickerOr(openTerminal: () => void): void {
  if (!openNewTabAgentPicker()) {
    openTerminal()
  }
}

// The New terminal shortcut opens the picker, so the + menu's New Terminal drops its chip.
export function newTerminalShortcutLabel(label: string): string {
  return pilotStore() ? '' : label
}
