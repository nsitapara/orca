// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  CodeBlock as CodeData,
  DetailsBundle,
  DiffBlock as DiffData
} from '../../shared/details'
import { CodeBlock, DiffBlock, FactsBlock, TextBlock, ThreadBlock } from './blocks'

afterEach(cleanup)

const F2: DetailsBundle = JSON.parse(
  readFileSync(join(process.cwd(), 'src/packages/pilot/test/fixtures/details/F2.json'), 'utf8')
)
function block<T>(type: string): T {
  return F2.blocks.find((b) => b.type === type) as T
}

describe('blocks', () => {
  it('keeps a script payload inert and shows it as text', () => {
    const { container } = render(
      <>
        <FactsBlock block={block('facts')} />
        <ThreadBlock block={block('thread')} />
        <TextBlock block={block('text')} />
      </>
    )
    expect(document.body.dataset.pwned).toBeUndefined()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x')
  })

  it("draws F2's diff with one add, one del, the del line number and the count", () => {
    const { container } = render(<DiffBlock block={block<DiffData>('diff')} />)
    expect(container.querySelectorAll('tr.add')).toHaveLength(1)
    expect(container.querySelectorAll('tr.del')).toHaveLength(1)
    expect(container.querySelector('tr.del td.ln')?.textContent).toBe('195')
    expect(container.querySelector('.glr-count')?.textContent).toBe('+1 −1')
    for (const table of container.querySelectorAll('table.glr-diff')) {
      expect(table.closest('.glr-scroll')).not.toBeNull()
    }
  })

  it('says what a capped diff left out', () => {
    const capped: DiffData = {
      type: 'diff',
      more_files: 3,
      files: [{ path: 'big.ts', hunks: [], omitted: true }]
    }
    const { container } = render(<DiffBlock block={capped} />)
    const lines = [...container.querySelectorAll('.dt-missing')].map((n) => n.textContent)
    expect(lines).toEqual([
      'big.ts: diff not shown here, too large; see the MR',
      '3 more files not shown here; see the MR'
    ])
  })

  it("draws F2's code block with its header and anchor row", () => {
    const { container } = render(<CodeBlock block={block<CodeData>('code')} />)
    expect(container.querySelector('.glr-path')?.textContent).toBe(
      'apps/staff/src/components/Pages/Family/PgtmReview/usePgtmWorkspaceRouting.ts @ 7cc153d0'
    )
    expect(container.querySelector('tr.anchor td.ln')?.textContent).toBe('195')
  })
})
