import { AutomationView } from './AutomationView'
import {
  setPilotOpenAutomation,
  setPilotOpenJob,
  showPilotAutomationsList,
  showPilotJob,
  usePilotAutomationsView,
  usePilotOpenAutomation,
  usePilotOpenJob
} from './automations-view'
import { JobView } from './JobView'
import { PilotAutomationsSection } from './PilotAutomationsSection'
import { RunPanelHost } from '../run-views/RunPanelHost'
import { ActivityPage } from './ActivityPage'
import { PlaygroundPage } from './playground/PlaygroundPage'
import { RunningPage } from './running/RunningPage'
import { InboxPage } from './waiting/InboxPage'

function PageBody(): React.JSX.Element {
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
  if (view === 'running') {
    return (
      <main className="relative flex h-full flex-col overflow-y-auto scrollbar-sleek bg-background">
        <RunningPage />
      </main>
    )
  }
  if (view === 'playground') {
    return (
      <main className="relative flex h-full flex-col bg-background">
        <PlaygroundPage />
      </main>
    )
  }
  if (view === 'activity') {
    return (
      <main className="relative flex h-full flex-col gap-4 overflow-y-auto bg-background px-5 pb-10 pt-6">
        <ActivityPage />
      </main>
    )
  }
  if (open) {
    return (
      <main className="relative flex h-full flex-col gap-4 overflow-y-auto bg-background px-5 pb-10 pt-6">
        <AutomationView
          key={open}
          id={open}
          onBack={showPilotAutomationsList}
          onOpenJob={showPilotJob}
        />
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

export default function PilotAutomationsPage(): React.JSX.Element {
  return (
    <div className="relative h-full">
      <PageBody />
      <RunPanelHost />
    </div>
  )
}
