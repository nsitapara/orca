import { useState } from 'react'
import { AutomationView } from './AutomationView'
import { usePilotAutomationsView } from './automations-view'
import { PilotAutomationsSection } from './PilotAutomationsSection'
import { WaitingOnYouPage } from './waiting/WaitingOnYouPage'

export default function PilotAutomationsPage(): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const view = usePilotAutomationsView()
  if (view === 'waiting') {
    return (
      <main className="relative flex h-full flex-col overflow-y-auto scrollbar-sleek bg-background px-5 pb-10 pt-6">
        <WaitingOnYouPage />
      </main>
    )
  }
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
