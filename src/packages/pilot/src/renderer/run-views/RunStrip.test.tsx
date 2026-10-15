// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { foldStrip, type StripChip } from '../../shared/run-views/strip'
import { RunStrip } from './RunStrip'

const chip = (over: Partial<StripChip>): StripChip => ({
  key: 'pre',
  label: 'MRs · 1 gate',
  who: 'pilot',
  state: 'done',
  runIds: [],
  part: 'starts',
  ...over
})

describe('RunStrip', () => {
  afterEach(cleanup)

  it('shows each chip with who runs it, its state and its count, and hands the clicked chip over', () => {
    const onChip = vi.fn()
    const lit = chip({
      key: 'step:0',
      label: 'Claude · review-mr',
      who: 'agent',
      state: 'running',
      runIds: ['a', 'b'],
      part: 'step:0'
    })
    render(<RunStrip items={foldStrip([chip({}), lit])} label="Run r1" onChip={onChip} />)
    expect(screen.getByRole('list', { name: 'Run r1' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Agent · Claude · review-mr · Running' }))
    expect(onChip).toHaveBeenCalledWith(lit)
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pilot · MRs · 1 gate · Done' })).toBeTruthy()
  })

  it('shows what was folded away as +N', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      chip({ key: `c${i}`, label: `c${i}`, state: null })
    )
    render(<RunStrip items={foldStrip(many)} label="Strip" onChip={() => {}} />)
    expect(screen.getByText('+4')).toBeTruthy()
  })
})
