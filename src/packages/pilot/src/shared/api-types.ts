export type PilotStatus = {
  version: string
  process: 'main' | 'orcad'
  dataPath: string
  automationDirs: string[]
  missingDirs: string[]
}

export type FieldValue = string | number | boolean | null
export type ItemFields = Record<string, FieldValue>

export type Verdict = 'started' | 'skipped' | 'notdue' | 'out_of_scope' | 'over_limit' | 'baselined'
export type CheckOutcome = { check: string; ok: boolean; reason: string }
export type TickItem = { key: string; label: string; fields: ItemFields }
export type ItemDecision = {
  key: string
  label: string
  verdict: Verdict
  reason: string
  checks: CheckOutcome[]
  onceKey: string
  fields: ItemFields
}
