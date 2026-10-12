import { describe, expect, it, vi } from 'vitest'
import { actionButton } from '../../shared/answer-actions'
import { buildActionCatalog } from './catalog'

describe('the answer buttons', () => {
  it('has a name for every action the catalog can run (start_run is the ask-first card’s own)', () => {
    const act = { run: vi.fn(), describe: vi.fn(), refresh: vi.fn(), command: vi.fn() }
    const linear = {} as never
    const names = buildActionCatalog({ act, linear } as never)
      .entries()
      .map((e) => e.name)
      .filter((n) => n !== 'start_run')
    expect(names.length).toBeGreaterThanOrEqual(7)
    for (const name of names) {
      expect(actionButton(name).label, name).not.toBe('Approve')
    }
  })
})
