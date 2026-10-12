// pilot automations import-state: an old sweep's state as Pilot rows (Task 34a).
// `at` is when the old sweep handled the key (else the import's time); `failedAt` is set for a failed one.
export type ImportedHandled = {
  onceKey: string
  status: 'started' | 'done' | 'failed'
  at?: number
  failedAt?: number | null
}
export type ImportedSession = {
  worktreePath: string
  terminalHandle: string
  agent: 'claude' | 'codex'
  label: string
}
export type ImportedFile = { from: string; to: string }
// An item the old sweep had already looked at (the `seen` table: first_seen rules read it).
export type ImportedSeen = { itemKey: string; at: number }
// An answer the old apply step already sent, for the card imported from <vaultRef> (`<note path>#<key>`).
export type ImportedDispatch = { vaultRef: string; answer: string }
export type ImportPlan = {
  automationId: string
  handled: ImportedHandled[]
  seen?: ImportedSeen[]
  dispatched?: ImportedDispatch[]
  sessions: ImportedSession[]
  files: ImportedFile[]
  notes: string[]
}
// present: already in Pilot before this call. added: written by this call (0 on a dry run).
export type ImportCount = { total: number; present: number; added: number }
export type ImportStateResult = {
  automationId: string
  apply: boolean
  plan: ImportPlan
  handled: ImportCount
  seen: ImportCount
  sessions: ImportCount
  dispatched: ImportCount
  files: ImportCount
}
