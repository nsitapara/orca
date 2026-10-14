import type { StoredResult } from '../../shared/api-types'

function headline(result: StoredResult): string {
  const said = result.reason ? `: ${result.reason}` : ''
  return `pilotcli ${result.command} · ${result.outcome}${said}`
}

function DataView({ result }: { result: StoredResult }): React.JSX.Element {
  if (result.data_omitted !== undefined) {
    return <div>{`Data not kept: ${result.data_omitted}`}</div>
  }
  return (
    <details>
      <summary className="cursor-pointer">Data</summary>
      <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-[11px]">
        {JSON.stringify(result.data ?? null, null, 2)}
      </pre>
    </details>
  )
}

// A shell step's stored pilotcli result on the run page: its command, outcome and reason, and its data as JSON, folded
// until opened. Data a result didn't keep (meta.text, too large) is named, never shown.
export function StepResultView({ result }: { result: StoredResult }): React.JSX.Element {
  return (
    <div className="text-muted-foreground">
      <div>{headline(result)}</div>
      <DataView result={result} />
    </div>
  )
}
