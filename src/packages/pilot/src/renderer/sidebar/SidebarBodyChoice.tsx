import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'
import { pilotStore } from '../store'

type SidebarBody = 'workspaces' | 'agents'

const CHOICES: { body: SidebarBody; label: string }[] = [
  { body: 'workspaces', label: 'Projects' },
  { body: 'agents', label: 'Activity' }
]

function isSidebarBody(value: string): value is SidebarBody {
  return value === 'workspaces' || value === 'agents'
}

/**
 * "Sidebar shows: Projects | Activity" in an options menu's View section, in either view: one click
 * switches the list. It replaced the bell beside the Projects title.
 */
export function SidebarBodyChoice(): React.JSX.Element | null {
  const body = useAppStore((s) => s.sidebarBody ?? 'workspaces')
  const setSidebarBody = useAppStore((s) => s.setSidebarBody)
  if (!pilotStore()) {
    return null
  }
  return (
    <DropdownMenuRadioGroup
      value={body}
      onValueChange={(value) => {
        if (isSidebarBody(value)) {
          setSidebarBody(value)
        }
      }}
      aria-label="Sidebar shows"
    >
      {CHOICES.map((choice) => (
        <DropdownMenuRadioItem key={choice.body} value={choice.body}>
          Sidebar shows {choice.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

/** pilot-hook: workspace-options-view. Projects' options menu has no View section, so the
 *  switch gets one of its own, first. */
export function SidebarBodyMenuSection(): React.JSX.Element | null {
  if (!pilotStore()) {
    return null
  }
  return (
    <>
      <DropdownMenuLabel>View</DropdownMenuLabel>
      <SidebarBodyChoice />
      <DropdownMenuSeparator />
    </>
  )
}
