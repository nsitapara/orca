import type { DetailsBlock, DetailsSnapshot } from '../../shared/details'
import { CodeBlock, FactsBlock, MissingBlock, TextBlock, ThreadBlock } from './blocks'
import { DiffBlock } from './diff-block'
import { DetailsStyle } from './details-css'
import { ScreensBlockView, ShotsBlockView } from './media'
import { ReportBlock } from './ReportBlock'
import { ReviewBlock } from './ReviewBlock'
import { SectionBar } from './SectionBar'
import { useOffSections } from './section-filter'
import { sectionKey, sectionsOf } from './sections'

function BlockView({
  block,
  snapshot,
  loadImage,
  openReport
}: {
  block: DetailsBlock
  snapshot: DetailsSnapshot
  loadImage: (file: string) => Promise<string>
  openReport?: (file: string) => Promise<void>
}): React.JSX.Element | null {
  switch (block.type) {
    case 'facts':
      return <FactsBlock block={block} />
    case 'diff':
      return (
        <DiffBlock
          block={block}
          patchStats={snapshot.ref.artifacts?.files.find((f) => f.ref === block.patch)?.diff}
        />
      )
    case 'screens':
      return <ScreensBlockView block={block} loadImage={loadImage} />
    case 'shots':
      return <ShotsBlockView block={block} loadImage={loadImage} />
    case 'code':
      return <CodeBlock block={block} />
    case 'thread':
      return <ThreadBlock block={block} />
    case 'text':
      return <TextBlock block={block} />
    case 'missing':
      return <MissingBlock block={block} />
    case 'review':
      return <ReviewBlock block={block} texts={snapshot.texts} />
    case 'report':
      return <ReportBlock block={block} open={openReport} />
  }
  // A block type this build doesn't know (the bundle check refuses one) shows nothing.
  return null
}

export function DetailsView({
  snapshot,
  loadImage,
  openReport
}: {
  snapshot: DetailsSnapshot
  loadImage: (file: string) => Promise<string>
  // Opens a report block's file outside Pilot; without it a report shows its name only.
  openReport?: (file: string) => Promise<void>
}): React.JSX.Element {
  const off = useOffSections()
  const sections = sectionsOf(snapshot.bundle, snapshot.texts)
  const shown = snapshot.bundle.blocks.filter((b) => !off.has(sectionKey(b)))
  return (
    <div className="glr dt min-w-0">
      <DetailsStyle />
      {snapshot.ref.artifacts?.provenance ? (
        <p className="mb-2 text-xs text-muted-foreground">
          Prepared by run {snapshot.ref.artifacts.provenance.preparingRunId} · attempt{' '}
          {snapshot.ref.artifacts.provenance.attempt}
          {snapshot.ref.artifacts.provenance.originatingRunId
            ? ` · originating run ${snapshot.ref.artifacts.provenance.originatingRunId}`
            : ''}
        </p>
      ) : null}
      <SectionBar sections={sections} off={off} />
      {shown.length === 0 && sections.length > 0 ? (
        <p className="dt-missing">No sections switched on. Pick one above.</p>
      ) : null}
      {shown.map((block, i) => (
        <BlockView
          key={i}
          block={block}
          snapshot={snapshot}
          loadImage={loadImage}
          openReport={openReport}
        />
      ))}
    </div>
  )
}
