import { Fragment, useEffect, useState } from 'react'
import type { ScreensBlock, ShotsBlock } from '../../shared/details'
import { Section } from './blocks'
import { useImageUrl } from './use-image'

const LOAD_FAILED = "couldn't load the image"

type Load = (file: string) => Promise<string>

// An in-page zoom: the browser would not open a blob: link from Pilot's window (its window-open handler
// hands only http(s) addresses on), so the same image is shown over the page. Escape or a click closes it.
function ZoomOverlay({ url, label, close }: { url: string; label: string; close: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close])
  return (
    <div className="dt-zoom" role="dialog" aria-modal="true" aria-label={label} onClick={close}>
      <img src={url} alt={label} />
    </div>
  )
}

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
  const [zoomed, setZoomed] = useState(false)
  if (failed) {
    return (
      <figure className="dt-shot">
        {caption ? <figcaption>{caption}</figcaption> : null}
        <p className="dt-missing">{LOAD_FAILED}</p>
      </figure>
    )
  }
  const label = caption || 'screenshot'
  return (
    <figure className="dt-shot">
      {caption ? <figcaption>{caption}</figcaption> : null}
      <button
        type="button"
        className="dt-zoom-btn"
        aria-label={`Zoom ${label}`}
        disabled={!url}
        onClick={() => setZoomed(true)}
      >
        <img src={url ?? undefined} alt={label} />
      </button>
      {zoomed && url ? (
        <ZoomOverlay url={url} label={label} close={() => setZoomed(false)} />
      ) : null}
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
