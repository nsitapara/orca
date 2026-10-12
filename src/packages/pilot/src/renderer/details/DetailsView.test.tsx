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
    const { container } = render(
      <DetailsView snapshot={snap(F2)} loadImage={loadImage} parts={null} />
    )
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
    const { container } = render(
      <DetailsView snapshot={snap(F2)} loadImage={loadImage} parts={null} />
    )
    await screen.findByText("couldn't load the image")
    await waitFor(() => expect(container.querySelectorAll('figure img[src]')).toHaveLength(2))
  })
})

describe('review block', () => {
  it('groups threads by file, then general comments', () => {
    const { container } = render(
      <DetailsView snapshot={reviewSnap()} loadImage={urlFor} parts={null} />
    )
    expect(container.querySelectorAll('.glr-file')).toHaveLength(3)
    expect(screen.getByText('General comments')).toBeTruthy()
    expect(container.querySelector('.glr-avatar')?.textContent).toBe('NS')
  })

  it('toggles a thread through the part switches', () => {
    const toggle = vi.fn()
    const words: [string, string] = ['Post', 'Skip']
    const { container, rerender } = render(
      <DetailsView snapshot={reviewSnap()} loadImage={urlFor} parts={{ off: [], toggle, words }} />
    )
    const button = container.querySelector('[data-part="1"] button') as HTMLElement
    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(button)
    expect(toggle).toHaveBeenCalledWith('1')
    rerender(
      <DetailsView
        snapshot={reviewSnap()}
        loadImage={urlFor}
        parts={{ off: ['1'], toggle, words }}
      />
    )
    const thread = container.querySelector('[data-part="1"]')
    expect(thread?.classList.contains('off')).toBe(true)
    expect(thread?.querySelector('button')?.getAttribute('aria-pressed')).toBe('false')
  })

  it('drops an unsafe MR link and names a missing review file', () => {
    const bad = JSON.stringify({ ...JSON.parse(REVIEW), web_url: 'javascript:x' })
    const { container } = render(
      <DetailsView snapshot={reviewSnap('r.json', bad)} loadImage={urlFor} parts={null} />
    )
    expect(container.querySelector('.glr-mr a')).toBeNull()
    cleanup()
    render(<DetailsView snapshot={reviewSnap('r.json', '{nope')} loadImage={urlFor} parts={null} />)
    expect(screen.getByText("Couldn't load the review file r.json")).toBeTruthy()
  })
})
