import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../../../shared/execution-host'
import { splitWorktreeIdForFilesystem } from '../../../../../shared/worktree/id'
import { pilotcliRunner, type Pilotcli } from '../envs/pilotcli'

// Hook target: src/main/ipc/worktrees/removal/worktree-removal-ownership.ts (pilot-hook: vault-notes-on-removal).
// Every removal that succeeds ends in removeWorktreeMetadataAndTransientState, and so does Forget, which keeps the
// checkout. Once the checkout is gone from disk, `pilotcli vault delete-notes` moves the worktree's notes folder
// (Agent Work/<repo>/…/<worktree>/, AGENTS.md's Notes and tracking) to Agent Work/Archive. A folder workspace, a
// worktree on another host, and a checkout still there after the wait (a Forget) are left alone.
export type NotesOnRemovalDeps = {
  pilotcli: Pilotcli
  exists: (path: string) => boolean
  sleep: (ms: number) => Promise<void>
  log: Pick<Console, 'info' | 'warn'>
}
export type NotesOnRemovalResult = 'archived' | 'kept' | 'skipped' | 'failed'

// Git deletes the checkout before the metadata purge, but a background removal can still be deleting it.
const WAIT_MS = 60_000
const POLL_MS = 2_000
const CALL_TIMEOUT_MS = 30_000

// Set by attachPilotMain; until then (and in orcad) the hook does nothing.
let attached: NotesOnRemovalDeps | null = null

export function attachVaultNotesOnRemoval(deps: NotesOnRemovalDeps | null): void {
  attached = deps
}

export function vaultNotesOnRemovalDeps(pilotBinDir: string): NotesOnRemovalDeps {
  return {
    pilotcli: pilotcliRunner({ pilotBinDir }),
    exists: existsSync,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    log: console
  }
}

// The hook: never throws and never waits, so a removal is never held up or failed by the vault.
export function archiveVaultNotesOnRemoval(
  worktreeId: string,
  hostId: ExecutionHostId | undefined,
  entryPoint: string
): void {
  const deps = attached
  if (!deps || entryPoint !== 'worktree-removal') {
    return
  }
  if (hostId && hostId !== LOCAL_EXECUTION_HOST_ID) {
    return
  }
  const path = splitWorktreeIdForFilesystem(worktreeId)?.worktreePath
  if (!path || !isAbsolute(path)) {
    return
  }
  void archiveWhenGone(deps, path).catch((error) => {
    deps.log.warn(`[pilot] vault notes of ${path}: ${String(error)}`)
  })
}

// Waits for the checkout at path to be gone, then archives its notes folder. 'kept' is a checkout still there.
export async function archiveWhenGone(
  deps: NotesOnRemovalDeps,
  path: string
): Promise<NotesOnRemovalResult> {
  for (let waited = 0; deps.exists(path); waited += POLL_MS) {
    if (waited >= WAIT_MS) {
      return 'kept'
    }
    await deps.sleep(POLL_MS)
  }
  const reply = await deps.pilotcli({
    args: ['vault', 'delete-notes', path, '--format', 'json'],
    timeoutMs: CALL_TIMEOUT_MS
  })
  if (reply.outcome === 'ok') {
    deps.log.info(`[pilot] archived the vault notes of ${path}`)
    return 'archived'
  }
  if (reply.outcome === 'skip') {
    return 'skipped'
  }
  deps.log.warn(`[pilot] couldn't archive the vault notes of ${path}: ${reply.reason}`)
  return 'failed'
}
