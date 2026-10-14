// A shell step's stored pilotcli result (steps.result_json; README: Shell steps, Results). data and meta as pilotcli
// printed them. data_omitted says why data wasn't kept (meta.text, or over 256 KB); then data is absent.
export type StoredResult = {
  command: string
  outcome: string
  reason: string
  data?: unknown
  meta?: Record<string, unknown>
  data_omitted?: string
}
