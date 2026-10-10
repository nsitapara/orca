export type PilotStatus = {
  version: string
  process: 'main' | 'orcad'
  dataPath: string
  automationDirs: string[]
  missingDirs: string[]
}

export type FieldValue = string | number | boolean | null
export type ItemFields = Record<string, FieldValue>
