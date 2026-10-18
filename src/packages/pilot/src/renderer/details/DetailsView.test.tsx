// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DetailsBundle, DetailsSnapshot } from '../../shared/details'
import { DetailsView } from './DetailsView'

afterEach(cleanup)

const DIR = join(process.cwd(), 'src/packages/pilot/test/fixtures/details')
const F2: DetailsBundle = JSON.parse(readFileSync(join(DIR, 'F2.json'), 'utf8'))
const REVIEW = readFileSync(join(DIR, 'sample-review.json'), 'utf8')

function snap(bundle: DetailsBundle, texts: Record<string, string> = {}): DetailsSnapshot {
  const ref = {
    path: '/b.json',
    sha256: 'x',
    inlined: {},
    blocks: 1,
    drafted: false,
    draftedBase: null
  }
  return { ref, bundle, texts }
}
function reviewSnap(file = 'r.json', text = REVIEW): DetailsSnapshot {
  const bundle: DetailsBundle = {
    version: 1,
    item: 'R',
    blocks: [{ type: 'review', title: 'Review', file }]
  }
  return snap(bundle, { [file]: text })
}
const urlFor = (file: string) => Promise.resolve(`blob:test/${file}`)

describe('DetailsView', () => {
  it("renders F2's titles, missing lines and images in bundle order", async () => {
    const loadImage = vi.fn(urlFor)
    const { container } = render(<DetailsView snapshot={snap(F2)} loadImage={loadImage} />)
    expect([...container.querySelectorAll('.dt-title')].map((n) => n.textContent)).toEqual([
      'What Approve does',
      'Proposed change',
      'Before and after',
      'QA screenshots',
      'Cause',
      'Reviewer thread',
      'Why'
    ])
    expect([...container.querySelectorAll('.dt-missing')].map((n) => n.textContent)).toEqual([
      'After screenshot (dark): not captured'
    ])
    await waitFor(() => expect(container.querySelectorAll('figure img[src]')).toHaveLength(3))
    expect(loadImage.mock.calls.map((c) => c[0])).toEqual([
      'F2-before.png',
      'F2-after.png',
      'F2-qa.png'
    ])
    expect(container.querySelector('figure img')?.getAttribute('src')).toBe(
      'blob:test/F2-before.png'
    )
    const thread = container.querySelector('.dt-thread a')
    expect(thread?.getAttribute('href')).toBe(
      'https://gitlab.com/polygenx/web-platform/-/merge_requests/1357#note_1'
    )
  })

  it('shows one failed image without losing the others', async () => {
    const loadImage = (file: string) =>
      file === 'F2-qa.png' ? Promise.reject(new Error('no')) : urlFor(file)
    const { container } = render(<DetailsView snapshot={snap(F2)} loadImage={loadImage} />)
    await screen.findByText("couldn't load the image")
    await waitFor(() => expect(container.querySelectorAll('figure img[src]')).toHaveLength(2))
  })
})

describe('images', () => {
  const shots = (shot: { file: string; caption?: string }): DetailsSnapshot =>
    snap({
      version: 1,
      item: 'S',
      blocks: [{ type: 'shots', title: 'Shots', shots: [shot] }]
    })

  it('renders no empty caption for a shot that fails to load', async () => {
    const { container } = render(
      <DetailsView
        snapshot={shots({ file: 'gone.png' })}
        loadImage={() => Promise.reject(new Error('no'))}
      />
    )
    await screen.findByText("couldn't load the image")
    expect(container.querySelector('figcaption')).toBeNull()
  })

  it('zooms a shot in the page, closed by Escape or a click, with no blob link', async () => {
    const { container } = render(
      <DetailsView snapshot={shots({ file: 'a.png', caption: 'QA' })} loadImage={urlFor} />
    )
    await waitFor(() => expect(container.querySelector('img[src]')).not.toBeNull())
    expect(container.querySelector('a[href^="blob:"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom QA' }))
    const zoomed = screen.getByRole('dialog').querySelector('img')
    expect(zoomed?.getAttribute('src')).toBe('blob:test/a.png')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom QA' }))
    fireEvent.click(screen.getByRole('dialog'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('moves focus into the zoom, keeps Tab there, and gives focus back on Escape without bubbling it', async () => {
    const outer = vi.fn()
    const listener = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        outer()
      }
    }
    document.addEventListener('keydown', listener)
    const { container } = render(
      <DetailsView snapshot={shots({ file: 'a.png', caption: 'QA' })} loadImage={urlFor} />
    )
    await waitFor(() => expect(container.querySelector('img[src]')).not.toBeNull())
    const button = screen.getByRole('button', { name: 'Zoom QA' })
    button.focus()
    fireEvent.click(button)
    const dialog = screen.getByRole('dialog')
    expect(document.activeElement).toBe(dialog)
    const tab = fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(tab).toBe(false)
    expect(document.activeElement).toBe(dialog)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(button)
    expect(outer).not.toHaveBeenCalled()
    document.removeEventListener('keydown', listener)
  })

  it('revokes a blob image URL when the view unmounts', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const { container, unmount } = render(
      <DetailsView snapshot={shots({ file: 'a.png' })} loadImage={urlFor} />
    )
    await waitFor(() => expect(container.querySelector('img[src]')).not.toBeNull())
    unmount()
    expect(revoke).toHaveBeenCalledWith('blob:test/a.png')
    revoke.mockRestore()
  })

  it('captions a screens pair Before and After', () => {
    const { container } = render(<DetailsView snapshot={snap(F2)} loadImage={urlFor} />)
    const pair = container.querySelector('.dt-pairs')
    expect([...(pair?.querySelectorAll('figcaption') ?? [])].map((n) => n.textContent)).toEqual([
      'Before',
      'After'
    ])
  })
})

describe('review block', () => {
  it('marks the row a finding is anchored to', () => {
    const { container } = render(<DetailsView snapshot={reviewSnap()} loadImage={urlFor} />)
    const anchors = [...container.querySelectorAll('.glr-diff tr.anchor')]
    const first = anchors.find((tr) => tr.querySelectorAll('td.ln')[1]?.textContent === '210')
    expect(first?.classList.contains('add')).toBe(true)
  })

  it('groups threads by file, then general comments', () => {
    const { container } = render(<DetailsView snapshot={reviewSnap()} loadImage={urlFor} />)
    expect(container.querySelectorAll('.glr-file')).toHaveLength(3)
    expect(screen.getByText('General comments')).toBeTruthy()
    expect(container.querySelector('.glr-avatar')?.textContent).toBe('NS')
  })

  // Only job 09's old Post cards carry one; they are shown as they were stored, with nothing to switch.
  it('shows a stored review read only, with no part switches', () => {
    const { container } = render(<DetailsView snapshot={reviewSnap()} loadImage={urlFor} />)
    expect(container.querySelectorAll('[data-part]').length).toBeGreaterThan(0)
    expect(container.querySelector('[data-part] button')).toBeNull()
  })

  it('drops an unsafe MR link and names a missing review file', () => {
    const bad = JSON.stringify({ ...JSON.parse(REVIEW), web_url: 'javascript:x' })
    const { container } = render(
      <DetailsView snapshot={reviewSnap('r.json', bad)} loadImage={urlFor} />
    )
    expect(container.querySelector('.glr-mr a')).toBeNull()
    cleanup()
    render(<DetailsView snapshot={reviewSnap('r.json', '{nope')} loadImage={urlFor} />)
    expect(screen.getByText("Couldn't load the review file r.json")).toBeTruthy()
  })
})
