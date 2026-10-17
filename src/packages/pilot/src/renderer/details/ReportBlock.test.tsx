// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReportBlock as ReportData } from '../../shared/details'
import { ReportBlock } from './ReportBlock'

afterEach(cleanup)

const GUIDE: ReportData = {
  type: 'report',
  title: 'Your review guide',
  file: '../../reviews/1579-815b3867-v1.html'
}

describe('ReportBlock', () => {
  it("shows the title and file name, and Open hands the block's file to open", async () => {
    const open = vi.fn().mockResolvedValue(undefined)
    render(<ReportBlock block={GUIDE} open={open} />)
    expect(screen.getByText('Your review guide')).toBeTruthy()
    expect(screen.getByText('1579-815b3867-v1.html')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith(GUIDE.file))
  })

  it('says why when the file could not be opened', async () => {
    const open = vi.fn().mockRejectedValue(new Error('report "x" is not a report'))
    render(<ReportBlock block={GUIDE} open={open} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByText(/Couldn.t open it: report "x" is not a report/)).toBeTruthy()
  })

  it('offers no Open where nothing can open it', () => {
    render(<ReportBlock block={GUIDE} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
