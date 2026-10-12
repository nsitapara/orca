// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TickItemRow } from '../../shared/api-types'
import { CheckTable } from './CheckTable'
import { CHECKS_WIDTHS_KEY } from './use-column-widths'

const item: TickItemRow = {
  tickId: 1,
  itemKey: '!1',
  label: '!1 a-very-long-branch-label-that-should-not-wrap',
  verdict: 'started',
  reason: 'All checks pass',
  checks: [{ check: 'Clean', ok: true, reason: 'ok' }],
  fields: {},
  runId: null
}

const handle = (name: string) => screen.getByRole('separator', { name: `Resize ${name} column` })
const colWidth = (index: number) =>
  (document.querySelectorAll('col')[index] as HTMLElement).style.width

function drag(name: string, from: number, to: number) {
  fireEvent.mouseDown(handle(name), { clientX: from })
  fireEvent.mouseMove(window, { clientX: to })
  fireEvent.mouseUp(window, { clientX: to })
}

describe('CheckTable column resizing', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('exposes vertical separators and shows the full label as a title', () => {
    render(<CheckTable items={[item]} checkNames={['Clean']} />)
    expect(handle('Item').getAttribute('aria-orientation')).toBe('vertical')
    expect(screen.getByTitle(item.label)).toBeTruthy()
    expect(document.querySelector('table')?.style.tableLayout).toBe('fixed')
  })

  it('dragging a header edge changes that column, never below its minimum', () => {
    render(<CheckTable items={[item]} checkNames={['Clean']} />)
    expect(colWidth(0)).toBe('200px')
    drag('Item', 500, 560)
    expect(colWidth(0)).toBe('260px')
    expect(colWidth(1)).toBe('150px')
    drag('Item', 500, 0)
    expect(colWidth(0)).toBe('100px')
  })

  it('remembers widths across mounts', () => {
    const first = render(<CheckTable items={[item]} checkNames={['Clean']} />)
    drag('Clean', 100, 140)
    expect(JSON.parse(window.localStorage.getItem(CHECKS_WIDTHS_KEY) ?? '{}')).toEqual({
      'check:Clean': 190
    })
    first.unmount()
    render(<CheckTable items={[item]} checkNames={['Clean']} />)
    expect(colWidth(1)).toBe('190px')
  })

  it('double-click resets one column to its default', () => {
    render(<CheckTable items={[item]} checkNames={['Clean']} />)
    drag('Item', 0, 80)
    drag('Clean', 0, 20)
    fireEvent.doubleClick(handle('Item'))
    expect(colWidth(0)).toBe('200px')
    expect(colWidth(1)).toBe('170px')
  })

  it('stops tracking a drag when unmounted mid-drag', () => {
    const view = render(<CheckTable items={[item]} checkNames={['Clean']} />)
    fireEvent.mouseDown(handle('Item'), { clientX: 0 })
    view.unmount()
    fireEvent.mouseMove(window, { clientX: 50 })
    fireEvent.mouseUp(window, { clientX: 50 })
    expect(window.localStorage.getItem(CHECKS_WIDTHS_KEY)).toBeNull()
  })

  it('keeps a check named Item apart from the fixed Item column', () => {
    render(<CheckTable items={[item]} checkNames={['Item']} />)
    fireEvent.mouseDown(screen.getAllByRole('separator', { name: 'Resize Item column' })[0], {
      clientX: 0
    })
    fireEvent.mouseMove(window, { clientX: 40 })
    fireEvent.mouseUp(window, { clientX: 40 })
    expect(colWidth(0)).toBe('240px')
    expect(colWidth(1)).toBe('150px')
  })

  it('still renders and resizes when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render(<CheckTable items={[item]} checkNames={['Clean']} />)
    expect(colWidth(0)).toBe('200px')
    drag('Item', 0, 30)
    expect(colWidth(0)).toBe('230px')
  })
})
