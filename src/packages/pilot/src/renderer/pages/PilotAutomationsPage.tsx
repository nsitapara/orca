import { useCallback, useEffect, useState } from 'react'
import type { InboxListPayload } from '../../shared/inbox-types'
import { pilotRpc } from '../api'
import { AutomationView } from './AutomationView'
import { PilotAutomationsSection } from './PilotAutomationsSection'
import { waitingCount } from './waiting/answer-text'
import { WaitingOnYouPage } from './waiting/WaitingOnYouPage'

type Tab = 'automations' | 'waiting'

// The count on the tab: every open card, whoever it is for (one person uses Pilot today).
function useWaitingTotal(): number {
  const [total, setTotal] = useState(0)
  const load = useCallback(() => {
    pilotRpc<InboxListPayload>('pilot.inbox.list', {}).then(
      (p) => setTotal(waitingCount(p.items)),
      () => setTotal(0)
    )
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, 20_000)
    return () => clearInterval(timer)
  }, [load])
  return total
}

export default function PilotAutomationsPage(): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('automations')
  const total = useWaitingTotal()
  if (open) {
    return (
      <main className="relative flex h-full flex-col gap-4 overflow-y-auto bg-background px-5 pb-10 pt-6">
        <AutomationView id={open} onBack={() => setOpen(null)} />
      </main>
    )
  }
  const tabs: { id: Tab; label: string }[] = [
    { id: 'automations', label: 'Automations' },
    { id: 'waiting', label: total ? `Waiting on you · ${total}` : 'Waiting on you' }
  ]
  return (
    <main className="relative flex h-full flex-col overflow-y-auto bg-background">
      <div className="flex gap-4 border-b border-border/50 px-5 pt-4 text-sm">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={
              tab === t.id ? 'border-b-2 border-foreground pb-1' : 'pb-1 text-muted-foreground'
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'waiting' ? (
        <div className="px-5 pb-10 pt-4">
          <WaitingOnYouPage />
        </div>
      ) : (
        <PilotAutomationsSection onOpen={setOpen} />
      )}
    </main>
  )
}
