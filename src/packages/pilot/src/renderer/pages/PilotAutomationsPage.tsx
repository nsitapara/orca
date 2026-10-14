import { AutomationView } from './AutomationView'
import {
  setPilotOpenAutomation,
  setPilotOpenJob,
  usePilotAutomationsView,
  usePilotOpenAutomation,
  usePilotOpenJob
} from './automations-view'
import { JobView } from './JobView'
import { PilotAutomationsSection } from './PilotAutomationsSection'
import { InboxPage } from './waiting/InboxPage'

export default function PilotAutomationsPage(): React.JSX.Element {
  const open = usePilotOpenAutomation()
  const job = usePilotOpenJob()
  const view = usePilotAutomationsView()
  if (view === 'inbox') {
    return (
      <main className="relative flex h-full flex-col overflow-y-auto scrollbar-sleek bg-background px-5 pb-10">
        <InboxPage />
      </main>
    )
  }
  if (open) {
    return (
      <main className="relative flex h-full flex-col gap-4 overflow-y-auto bg-background px-5 pb-10 pt-6">
        <AutomationView key={open} id={open} onBack={() => setPilotOpenAutomation(null)} />
      </main>
    )
  }
  if (job) {
    return (
      <main className="relative flex h-full flex-col gap-4 overflow-y-auto bg-background px-5 pb-10 pt-6">
        <JobView
          key={job}
          jobId={job}
          onBack={() => setPilotOpenJob(null)}
          onOpenStage={setPilotOpenAutomation}
        />
      </main>
    )
  }
  return (
    <main className="relative flex h-full flex-col overflow-y-auto bg-background">
      <PilotAutomationsSection onOpen={setPilotOpenAutomation} onOpenJob={setPilotOpenJob} />
    </main>
  )
}
