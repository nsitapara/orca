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
  n: null,
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

  it('numbers a step, lights the one it is told to without a ?, and ends with what did not run', () => {
    const asked = chip({ key: 'step:2', label: 'r1_codex', who: 'agent', part: 'step:2', n: 2 })
    const waiting = chip({ key: 'step:4', label: 'r2_claude', who: 'agent', state: 'asking', n: 3 })
    render(
      <RunStrip
        items={[
          ...foldStrip([asked, waiting]),
          { kind: 'note', key: 'not-run', text: "3 didn't run" }
        ]}
        label="Run r1"
        highlight="step:2"
        onChip={() => {}}
      />
    )
    const step = screen.getByRole('button', { name: 'Agent · 2 r1_codex · Done' })
    expect(step.dataset.highlighted).toBe('')
    expect(
      screen.getByRole('button', { name: 'Agent · 3 r2_claude · Waiting on you' }).dataset
        .highlighted
    ).toBeUndefined()
    expect(screen.queryByText('?')).toBeNull()
    expect(screen.getByText("3 didn't run")).toBeTruthy()
  })

  it('shows what was folded away as +N', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      chip({ key: `c${i}`, label: `c${i}`, state: null })
    )
    render(<RunStrip items={foldStrip(many)} label="Strip" onChip={() => {}} />)
    expect(screen.getByText('+4')).toBeTruthy()
  })

  it('keeps a chip click from reaching the row under it', () => {
    const onChip = vi.fn()
    const rowClick = vi.fn()
    render(
      <div onClick={rowClick}>
        <RunStrip items={foldStrip([chip({})])} label="Strip" onChip={onChip} />
      </div>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Pilot · MRs · 1 gate · Done' }))
    expect(onChip).toHaveBeenCalledTimes(1)
    expect(rowClick).not.toHaveBeenCalled()
  })
})
