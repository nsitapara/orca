import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isWebClientLocation } from '@/lib/web-client-location'
import { pilotStore } from '../store'

// A skill's file as a floating-workspace document: its tab reads <skill>/SKILL.md.
export function skillDocument(filePath: string): { filePath: string; relativePath: string } {
  return { filePath, relativePath: filePath.split('/').slice(-2).join('/') }
}

// A file that belongs to no worktree opens in the floating workspace's editor, as the OS's "Open With" does
// (os-markdown-file-open-bridge.ts): enable the floating workspace, then reveal it a frame later.
export async function openInFloatingWorkspace(filePath: string): Promise<void> {
  const [{ useAppStore }, { openDocumentInFloatingWorkspace }, { revealFloatingWorkspacePanel }] =
    await Promise.all([
      import('@/store'),
      import('@/lib/open-document-in-floating-workspace'),
      import('@/lib/floating-workspace-panel-reveal')
    ])
  const store = useAppStore.getState()
  openDocumentInFloatingWorkspace(store.openFile, skillDocument(filePath))
  if (store.settings?.floatingTerminalEnabled !== true) {
    await store.updateSettings({ floatingTerminalEnabled: true })
  }
  requestAnimationFrame(() => revealFloatingWorkspacePanel(useAppStore.getState()))
}

// Upstream's skill details gain Open (hook skill-open-file): the SKILL.md in the editor, to read before using it.
// Inert until attachPilotRenderer registers the store, so upstream's own tests see the dialog as it was.
export function OpenSkillFile({
  filePath,
  onOpened,
  open = openInFloatingWorkspace
}: {
  filePath: string
  onOpened: () => void
  open?: (filePath: string) => Promise<void>
}): React.JSX.Element | null {
  // Why: the browser version reads no files outside a worktree.
  if (!pilotStore() || isWebClientLocation()) {
    return null
  }
  const click = (): void => {
    open(filePath).then(onOpened, (error: unknown) =>
      console.error(`[pilot] couldn't open ${filePath}:`, error)
    )
  }
  return (
    <Button type="button" variant="ghost" size="sm" onClick={click}>
      <FileText className="size-3.5" />
      Open
    </Button>
  )
}
