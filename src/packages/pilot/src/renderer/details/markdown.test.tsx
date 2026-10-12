// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DETAILS_CSS } from './details-css'
import { Inline, Markdown } from './markdown'

afterEach(cleanup)

describe('Inline', () => {
  it('renders code, bold, and links; only http(s) gets an href', () => {
    const { container } = render(
      <Inline text="a `b` **c** [x](javascript:alert(1)) [y](https://g.l/z)" />
    )
    expect(container.querySelector('code')?.textContent).toBe('b')
    expect(container.querySelector('strong')?.textContent).toBe('c')
    const links = [...container.querySelectorAll('a')]
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('https://g.l/z')
    expect(links[0].getAttribute('rel')).toContain('noopener')
    expect(links[0].getAttribute('target')).toBe('_blank')
    expect(container.textContent).toContain('x')
    expect(container.innerHTML).not.toContain('javascript:alert(1)"')
  })
})

describe('Markdown', () => {
  it('hides comments and renders a fence and a list', () => {
    const src = '<!-- marker -->\nhello\n\n```py\nx = 1\n```\n\n- one\n- two'
    const { container } = render(<Markdown source={src} />)
    expect(container.textContent).not.toContain('marker')
    expect(container.querySelectorAll('pre > code')).toHaveLength(1)
    expect(container.querySelectorAll('ul')).toHaveLength(1)
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })
})

describe('DETAILS_CSS', () => {
  it('has dark tokens under .dark and no media query for the theme', () => {
    expect(DETAILS_CSS).toContain('.dark .glr{')
    expect(DETAILS_CSS).not.toContain('prefers-color-scheme')
    expect(DETAILS_CSS).toMatch(/\.glr-body pre\{[^}]*overflow-x:auto/)
  })
})
