import { useEffect, useState } from 'react'
import { isWebClientLocation } from '@/lib/web-client-location'
import type { SourceIndex, StepSource } from '../../shared/source-types'
import { stepSource } from '../../shared/run-views/step-source'
import type { ChainPart } from '../../shared/run-views/chain'
import { pilotRpc } from '../api'
import { openInFloatingWorkspace } from '../skills/OpenSkillFile'

// One read for every row on screen; main keeps it a minute (main/step-source).
let pending: Promise<SourceIndex | null> | null = null

function sourceIndex(): Promise<SourceIndex | null> {
  pending ??= pilotRpc<SourceIndex | null>('pilot.sourceIndex.get').then(
    (index) => (typeof index?.skillsDir === 'string' ? index : null),
    () => null
  )
  return pending
}

// Tests only: the next row reads the index again.
export function resetSourceIndex(): void {
  pending = null
}

function useSourceIndex(): SourceIndex | null {
  const [index, setIndex] = useState<SourceIndex | null>(null)
  useEffect(() => {
    let alive = true
    void sourceIndex().then((i) => alive && setIndex(i))
    return () => {
      alive = false
    }
  }, [])
  return index
}

// A click reads the index again (main keeps it at most a minute): pilotcli's source_root is where main is checked out
// now, which can move after the link was drawn. Without a fresh index the drawn source still opens.
async function sourceAtClick(
  part: Pick<ChainPart, 'skill' | 'runs'>,
  drawn: StepSource
): Promise<StepSource> {
  pending = null
  const index = await sourceIndex()
  return (index ? stepSource(part, index) : null) ?? drawn
}

// pilotcli's code opens at its line in the worktree Pilot knows it by; with none there, the file opens on its own.
async function openStepSource(source: StepSource): Promise<void> {
  if (source.kind === 'file') {
    return openInFloatingWorkspace(source.path)
  }
  try {
    await pilotRpc('files.open', {
      worktree: `path:${source.root}`,
      relativePath: source.file,
      line: source.line
    })
  } catch {
    await openInFloatingWorkspace(`${source.root}/${source.file}`)
  }
}

// A chain row's Source: the skill an agent step uses, or the pilotcli command a shell step runs.
export function SourceLink({
  part
}: {
  part: Pick<ChainPart, 'skill' | 'runs'>
}): React.JSX.Element | null {
  // Why: files.open would act on the server Mac's window, and the browser never reads the index.
  if (isWebClientLocation()) {
    return null
  }
  return <ServerSourceLink part={part} />
}

function ServerSourceLink({
  part
}: {
  part: Pick<ChainPart, 'skill' | 'runs'>
}): React.JSX.Element | null {
  const index = useSourceIndex()
  const source = index ? stepSource(part, index) : null
  if (!source) {
    return null
  }
  const open = (): void => {
    sourceAtClick(part, source)
      .then(openStepSource)
      .catch((error: unknown) => console.error("[pilot] couldn't open the step's source:", error))
  }
  return (
    <button type="button" className="shrink-0 text-xs underline" onClick={open}>
      Source
    </button>
  )
}
