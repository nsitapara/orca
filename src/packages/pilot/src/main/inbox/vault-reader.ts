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
  return JSON.parse(result.stdout) as VaultRow[]
}
