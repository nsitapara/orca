import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActivityTick, AutomationDetailPayload } from '../../shared/api-types'
import { pilotRpc } from '../api'
import { AutomationOverview } from './AutomationOverview'
import { ActivityTimeline } from './ActivityTimeline'
import { errorText } from './format'
import { RunControls } from './RunControls'

type Tab = 'overview' | 'activity'
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity' }
]

export function AutomationView({
  id,
  onBack
}: {
  id: string
  onBack: () => void
}): React.JSX.Element {
  const [detail, setDetail] = useState<AutomationDetailPayload | null>(null)
  const [ticks, setTicks] = useState<ActivityTick[]>([])
  const [tab, setTab] = useState<Tab>('activity')
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const refresh = useCallback(async () => {
    try {
      const d = await pilotRpc<AutomationDetailPayload>('pilot.automations.get', { id })
      const t = await pilotRpc<ActivityTick[]>('pilot.automations.activity', { id, limit: 30 })
      if (!mounted.current) {
        return
      }
      setDetail(d)
      setTicks(t)
      setError(null)
    } catch (e) {
      if (mounted.current) {
        setError(errorText(e))
      }
    }
  }, [id])
  useEffect(() => {
    mounted.current = true
    void refresh()
    const timer = setInterval(() => void refresh(), 20_000)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [refresh])

  const back = (
    <button type="button" className="text-left text-sm text-muted-foreground" onClick={onBack}>
      Automations
    </button>
  )
  if (!detail) {
    return (
      <div className="flex flex-col gap-3">
        {back}
        <p className={error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
          {error ?? 'Loading…'}
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm">
        {back}
        <span className="text-muted-foreground">›</span>
        <span>{detail.summary.name}</span>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <h2 className="text-lg font-semibold">{detail.summary.name}</h2>
        <span className="flex-1" />
        <RunControls id={id} onDone={() => void refresh()} />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-4 border-b border-border/50 text-sm">
        {TABS.map((t) => (
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
      {tab === 'activity' ? (
        <ActivityTimeline ticks={ticks} checkNames={detail.checkNames} notes={detail.notes ?? []} />
      ) : (
        <AutomationOverview detail={detail} />
      )}
    </div>
  )
}
