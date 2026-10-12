import { Fragment } from 'react'
import type { ScreensBlock, ShotsBlock } from '../../shared/details'
import { Section } from './blocks'
import { useImageUrl } from './use-image'

const LOAD_FAILED = "couldn't load the image"

type Load = (file: string) => Promise<string>

function LoadedShot({
  path,
  caption,
  loadImage
}: {
  path: string
  caption?: string | null
  loadImage: Load
}): React.JSX.Element {
  const { url, failed } = useImageUrl(() => loadImage(path))
  if (failed) {
    return (
      <figure className="dt-shot">
        <figcaption>{caption ?? ''}</figcaption>
        <p className="dt-missing">{LOAD_FAILED}</p>
      </figure>
    )
  }
  return (
    <figure className="dt-shot">
      {caption ? <figcaption>{caption}</figcaption> : null}
      <a href={url ?? undefined} target="_blank" rel="noopener noreferrer">
        <img src={url ?? undefined} alt={caption || 'screenshot'} />
      </a>
    </figure>
  )
}

function Shot({
  path,
  caption,
  loadImage
}: {
  path?: string | null
  caption?: string | null
  loadImage: Load
}): React.JSX.Element {
  if (!path) {
    return (
      <figure className="dt-shot">
        {caption ? <figcaption>{caption}</figcaption> : null}
        <p className="dt-missing">not captured</p>
      </figure>
    )
  }
  return <LoadedShot path={path} caption={caption} loadImage={loadImage} />
}

export function ScreensBlockView({
  block,
  loadImage
}: {
  block: ScreensBlock
  loadImage: Load
}): React.JSX.Element {
  return (
    <Section title={block.title} cls="dt-screens">
      {(block.pairs ?? []).map((pair, i) => {
        const meta = [pair.route, pair.theme, pair.viewport].filter(Boolean).join(' · ')
        return (
          <Fragment key={i}>
            {pair.caption ? <p>{pair.caption}</p> : null}
            <div className="dt-pairs">
              <Shot path={pair.before} caption="Before" loadImage={loadImage} />
              <Shot path={pair.after} caption="After" loadImage={loadImage} />
            </div>
            {meta ? <p className="dt-meta">{meta}</p> : null}
            {pair.note ? <p className="dt-meta">{pair.note}</p> : null}
          </Fragment>
        )
      })}
    </Section>
  )
}

export function ShotsBlockView({
  block,
  loadImage
}: {
  block: ShotsBlock
  loadImage: Load
}): React.JSX.Element {
  return (
    <Section title={block.title} cls="dt-shots-box">
      <div className="dt-shots">
        {(block.shots ?? []).map((item, i) => (
          <Shot key={i} path={item.file} caption={item.caption} loadImage={loadImage} />
        ))}
      </div>
    </Section>
  )
}
