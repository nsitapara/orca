import { useState } from 'react'
import { AutomationView } from './AutomationView'
import { PilotAutomationsSection } from './PilotAutomationsSection'

// The Automations page: Pilot's YAML automations. Orca's own engine is off in Pilot (hook
// orca-automations-off), so its page isn't shown.
export default function PilotAutomationsPage(): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  if (open) {
    return (
      <main className="relative flex h-full flex-col gap-4 overflow-y-auto bg-background px-5 pb-10 pt-6">
        <AutomationView id={open} onBack={() => setOpen(null)} />
      </main>
    )
  }
  return (
    <main className="relative flex h-full flex-col overflow-y-auto bg-background">
      <PilotAutomationsSection onOpen={setOpen} />
    </main>
  )
}
