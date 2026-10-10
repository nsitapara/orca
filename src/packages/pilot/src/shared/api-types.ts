export type PilotStatus = {
  version: string
  process: 'main' | 'orcad'
  dataPath: string
  automationDirs: string[]
  missingDirs: string[]
}
