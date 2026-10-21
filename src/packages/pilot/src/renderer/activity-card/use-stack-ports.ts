import { useEffect, useMemo, useState } from 'react'
import type { Repo } from '../../../../../shared/repo-types'
import type { WorkspacePort } from '../../../../../shared/workspace-ports'
import type { Worktree } from '../../../../../shared/worktree/types'
import { getRuntimeTargetForWorktreeOwner } from '@/lib/file-owner-runtime-target'
import { joinPath } from '@/lib/path'
import { readRuntimeFileContent } from '@/runtime/runtime-file-read-client'
import { useAppStore } from '@/store'
import { buildStackPorts, STACK_PORTS_FILE, type StackPort } from './stack-ports'

// Read on mount, and again once the stack's ports come up: a header's chip mounts long before.
function useStackPortsFile(worktree: Worktree, repo: Repo | null, live: boolean): string | null {
  const [content, setContent] = useState<string | null>(null)
  const connectionId = repo?.connectionId ?? undefined
  useEffect(() => {
    const target = getRuntimeTargetForWorktreeOwner(useAppStore.getState(), worktree.id)
    if (!target || !worktree.path) {
      return
    }
    let cancelled = false
    readRuntimeFileContent({
      target,
      filePath: joinPath(worktree.path, STACK_PORTS_FILE),
      relativePath: STACK_PORTS_FILE,
      worktreeId: worktree.id,
      connectionId
    })
      .then((result) => {
        if (!cancelled && !result.isBinary) {
          setContent(result.content)
        }
      })
      // No file, or a host whose files the desktop can't read (SSH): the card lists live ports as before.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [worktree.id, worktree.path, connectionId, live])
  return content
}

/** The worktree's live ports, split into the ones its `.env.ports` declares and the rest. */
export function useStackPorts(
  worktree: Worktree,
  repo: Repo | null,
  livePorts: WorkspacePort[]
): { stack: StackPort[]; others: WorkspacePort[] } {
  const content = useStackPortsFile(worktree, repo, livePorts.length > 0)
  return useMemo(
    () =>
      content === null ? { stack: [], others: livePorts } : buildStackPorts(content, livePorts),
    [content, livePorts]
  )
}
