import { Component, lazy, Suspense, useMemo, useState } from 'react'

// Lazy so Orca's page (and its app-store graph) loads in its own chunk behind the error boundary.
const loadOrcaPage = (): Promise<{ default: React.ComponentType }> =>
  import('../../../../../renderer/src/components/automations/AutomationsPage')

type BoundaryProps = { children: React.ReactNode; onRetry: () => void }

class OrcaPageBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error): void {
    console.error("[pilot] Orca's Automations page failed", error)
  }

  render(): React.ReactNode {
    if (!this.state.failed) {
      return this.props.children
    }
    return (
      <div className="flex flex-col items-start gap-2 px-5 py-4 text-sm">
        <p className="text-destructive">Orca&apos;s Automations page couldn&apos;t load.</p>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1 hover:bg-muted"
          onClick={() => {
            this.setState({ failed: false })
            this.props.onRetry()
          }}
        >
          Retry
        </button>
      </div>
    )
  }
}

export function OrcaAutomationsPanel(): React.JSX.Element {
  const [attempt, setAttempt] = useState(0)
  // A failed React.lazy caches its rejection, so Retry builds a fresh one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const Page = useMemo(() => lazy(loadOrcaPage), [attempt])
  return (
    <OrcaPageBoundary onRetry={() => setAttempt((n) => n + 1)}>
      <Suspense fallback={<p className="px-5 pt-3 text-sm text-muted-foreground">Loading…</p>}>
        <Page />
      </Suspense>
    </OrcaPageBoundary>
  )
}
