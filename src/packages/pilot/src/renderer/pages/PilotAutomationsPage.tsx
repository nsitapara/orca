import { useState } from 'react'
import { AutomationView } from './AutomationView'
import { OrcaAutomationsPanel } from './OrcaAutomationsPanel'
import { PilotAutomationsSection } from './PilotAutomationsSection'

// One page: Orca's automations (the jobs, run by Orca's engine inside Pilot), then Pilot's YAML ones.
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
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-hidden">
        <OrcaAutomationsPanel />
      </div>
      <div className="max-h-[40%] shrink-0 overflow-y-auto border-t border-border">
        <PilotAutomationsSection onOpen={setOpen} />
      </div>
    </div>
  )
}
