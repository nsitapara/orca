import { toast } from 'sonner'
import {
  copyArtifactLink,
  openArtifactInBrowser
} from '@/components/artifacts/artifact-link-actions'
import { isWebClientLocation } from '@/lib/web-client-location'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../shared/execution-host'
import type { AgentArtifact } from '../../shared/api-types-artifacts'

export async function copyText(text: string, done: string): Promise<void> {
  try {
    await window.api.ui.writeClipboardText(text)
    toast.success(done)
  } catch {
    toast.error('Could not copy to the clipboard')
  }
}

// A file in the index is on the machine Pilot runs on: the desktop opens it; the browser version can't reach it.
export function canOpenLocalFiles(): boolean {
  return !isWebClientLocation()
}

export function openLocalFile(path: string): void {
  void window.api.shell.openPath(path, LOCAL_EXECUTION_HOST_ID).catch(() => {
    toast.error('Could not open the file')
  })
}

/** A claude.ai artifact opens in the browser (its sign-in lives there); a vault report opens from disk. */
export function openAgentArtifact(artifact: AgentArtifact): void {
  if (artifact.source === 'local') {
    openLocalFile(artifact.url)
    return
  }
  openArtifactInBrowser(artifact.url)
}

export function copyAgentArtifact(artifact: AgentArtifact): void {
  if (artifact.source === 'local') {
    void copyText(artifact.url, 'Path copied')
    return
  }
  void copyArtifactLink(artifact.url)
}

export function canOpenAgentArtifact(artifact: AgentArtifact): boolean {
  return artifact.source !== 'local' || canOpenLocalFiles()
}

/** The vault's folder, from a vault report (its url is the vault folder plus its vault-relative id), or null. */
export function vaultRootOf(artifacts: readonly AgentArtifact[]): string | null {
  for (const artifact of artifacts) {
    if (
      artifact.source === 'local' &&
      artifact.url.length > artifact.id.length &&
      artifact.url.endsWith(`/${artifact.id}`)
    ) {
      return artifact.url.slice(0, -artifact.id.length - 1)
    }
  }
  return null
}
