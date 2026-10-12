import type { DetailsBlock, DetailsSnapshot } from '../../shared/details'
import { CodeBlock, DiffBlock, FactsBlock, MissingBlock, TextBlock, ThreadBlock } from './blocks'
import { DetailsStyle } from './details-css'
import { ScreensBlockView, ShotsBlockView } from './media'
import { ReviewBlock, type PartSwitches } from './ReviewBlock'

export type { PartSwitches }

function BlockView({
  block,
  snapshot,
  loadImage,
  parts
}: {
  block: DetailsBlock
  snapshot: DetailsSnapshot
  loadImage: (file: string) => Promise<string>
  parts: PartSwitches | null
}): React.JSX.Element | null {
  switch (block.type) {
    case 'facts':
      return <FactsBlock block={block} />
    case 'diff':
      return <DiffBlock block={block} />
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
      return <ReviewBlock block={block} texts={snapshot.texts} parts={parts} />
    default:
      return null
  }
}

export function DetailsView({
  snapshot,
  loadImage,
  parts
}: {
  snapshot: DetailsSnapshot
  loadImage: (file: string) => Promise<string>
  parts: PartSwitches | null
}): React.JSX.Element {
  return (
    <div className="glr dt min-w-0">
      <DetailsStyle />
      {snapshot.bundle.blocks.map((block, i) => (
        <BlockView key={i} block={block} snapshot={snapshot} loadImage={loadImage} parts={parts} />
      ))}
    </div>
  )
}
