import { Copy, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import type { AgentArtifact } from '../../shared/api-types-artifacts'
import { copyAgentArtifact, openAgentArtifact } from './artifact-actions'
import { artifactTitle } from './artifact-labels'
import {
  BuiltBySection,
  SourceFilesSection,
  TicketsSection,
  VaultNotesSection
} from './ArtifactDrawerSections'

/**
 * An agent artifact's links: open or copy it, then its tickets, the vault notes that link to it, the files it was
 * published from, and every session that published it. Escape closes it (Radix marks the key handled, so the
 * page's own Escape doesn't also close the page).
 */
export function AgentArtifactDrawer({
  artifact,
  vaultRoot,
  onClose
}: {
  artifact: AgentArtifact | null
  vaultRoot: string | null
  onClose: () => void
}): React.JSX.Element {
  return (
    <Sheet open={artifact !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-[min(30rem,100vw)] sm:max-w-[30rem]">
        {artifact ? (
          <div className="scrollbar-sleek flex h-full min-h-0 flex-col gap-5 overflow-y-auto px-5 pt-4 pb-7">
            <div className="flex flex-col gap-1.5 pr-8">
              <SheetTitle>{artifactTitle(artifact)}</SheetTitle>
              <SheetDescription>
                {artifact.description || 'No description recorded.'}
              </SheetDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => openAgentArtifact(artifact)}>
                <ExternalLink className="size-3.5" />
                Open artifact
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => copyAgentArtifact(artifact)}
              >
                <Copy className="size-3.5" />
                Copy link
              </Button>
            </div>
            <TicketsSection tickets={artifact.tickets} />
            <VaultNotesSection notes={artifact.vault_notes} vaultRoot={vaultRoot} />
            <SourceFilesSection files={artifact.source_files} />
            <BuiltBySection artifact={artifact} />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
