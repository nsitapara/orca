import { homedir } from 'node:os'
import { join } from 'node:path'
import type { InboxType } from '../../shared/api-types'
import { bridgeEnv, runWithProcessHost, type ProcessRun } from '../actions/act-bridge'

// What `vault.py export-open` prints per open item (Task 27a).
export type VaultRow = {
  note: string
  key: string
  kind: InboxType
  family: 'question' | 'action'
  summary: string
  location: string
  context: string
  suggested: string
  options: { label: string; description: string }[]
  run_command: string
  parts: { id: string; label: string; run: string; outcome: string }[]
  switch: string[]
  details: string
  details_path: string
  digest: string
  answer: string
  replies: string[]
  status: 'waiting' | 'answered' | 'applying'
  resume: string
  session: string
  asked_in: string
  section_time: string
  created_at: string | null
  worktree: string | null
  mr_iid: number | null
  job: string
  job_code: string
  skill: string
  scope: 'branch' | 'job'
  branch: string
  bound: string | false | null
}

const TIMEOUT_MS = 120_000
const STRING_FIELDS = ['note', 'key', 'kind', 'summary'] as const
const LIST_FIELDS = ['options', 'parts', 'switch', 'replies'] as const

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('vault.py export-open did not print JSON')
  }
}

// The export's shape, checked once: a vault.py older than Pilot expects fails here with the field named,
// not later inside the import.
function checkRows(value: unknown): VaultRow[] {
  if (!Array.isArray(value)) {
    throw new Error('vault.py export-open did not print a list')
  }
  value.forEach((row, at) => {
    if (typeof row !== 'object' || row === null) {
      throw new Error(`row ${at} is not an object`)
    }
    const fields = row as Record<string, unknown>
    for (const name of STRING_FIELDS) {
      if (typeof fields[name] !== 'string' || fields[name] === '') {
        throw new Error(`vault.py is older than Pilot expects: row ${at} has no "${name}"`)
      }
    }
    for (const name of LIST_FIELDS) {
      if (fields[name] !== undefined && !Array.isArray(fields[name])) {
        throw new Error(`row ${at}: "${name}" must be a list`)
      }
    }
  })
  return value as VaultRow[]
}

export async function readOpenVaultItems(
  opts: { vaultPy?: string; python?: string; run?: ProcessRun; env?: NodeJS.ProcessEnv } = {}
): Promise<VaultRow[]> {
  const env = opts.env ?? process.env
  const vaultPy =
    opts.vaultPy ??
    env.PILOT_VAULT_PY ??
    join(homedir(), '.agents', 'skills', 'worktree-gate', 'vault.py')
  const result = await (opts.run ?? runWithProcessHost)({
    program: opts.python ?? env.PILOT_PYTHON ?? 'python3',
    args: [vaultPy, 'export-open'],
    env: bridgeEnv(env, null),
    timeoutMs: TIMEOUT_MS
  })
  if (result.code !== 0 || result.timedOut) {
    const said = (result.stderr || result.stdout).trim().slice(-300)
    throw new Error(`vault.py export-open failed (exit ${result.code}): ${said}`)
  }
  return checkRows(parseJson(result.stdout))
}
