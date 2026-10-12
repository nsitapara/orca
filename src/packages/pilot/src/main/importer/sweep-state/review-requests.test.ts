import { describe, expect, it } from 'vitest'
import { preparedKeys, reviewRequestsState } from './review-requests'
import { stateReader } from './test-reader'

const FOLDER = '09 · Prepare reviews requested of me'
const ITEMS = [
  '# Prepare reviews requested of me',
  '',
  '## 2026-10-10 09:30 · 09a-20261010T0930 · shell',
  '',
  '- [x] **action** · Prepare a review of !1571? — `web-2097-fix-cves-schedule @12cace69` · ✓ skipped',
  '  Answer: skip',
  '- [x] **action** · Prepare a review of !1579? — `web-2107-figaro-selector @815b3867` · ✓ prepared → 3a3f25b54519589a',
  '- [ ] **action** · Prepare a review of !1600? — `web-1600-donor-status @1e345678`',
  '  Answer:',
  '- [ ] **action** · Post your review of !1579? — `web-2107-figaro-selector @815b3867`',
  ''
].join('\n')

function reader(notes: Record<string, string>) {
  return stateReader({
    note: (rel) => notes[rel] ?? null,
    notes: (folder) =>
      Object.keys(notes)
        .filter((k) => k.startsWith(`${folder}/`))
        .map((k) => k.slice(folder.length + 1))
        .sort()
  })
}

describe('preparedKeys', () => {
  it('keys every Prepare card by its MR and 8-character head; ticked cards are done, open ones started', () => {
    expect(preparedKeys(ITEMS)).toEqual([
      { onceKey: '1571:12cace69', status: 'done' },
      { onceKey: '1579:815b3867', status: 'done' },
      { onceKey: '1600:1e345678', status: 'started' }
    ])
  })
})

describe('reviewRequestsState', () => {
  it('reads Items.md and the branch notes, never the job note or Runs.md, and lets a done card win', () => {
    const plan = reviewRequestsState.plan(
      reader({
        [`${FOLDER}/Items.md`]: ITEMS,
        [`${FOLDER}/web-2107-figaro-selector.md`]:
          '- [ ] **action** · Prepare a review of !1579? — `web-2107-figaro-selector @815b3867`\n',
        [`${FOLDER}/Runs.md`]: '- [ ] **action** · Prepare a review of !9999? — `x @deadbeef`\n',
        [`${FOLDER}/${FOLDER}.md`]:
          '- [ ] **action** · Prepare a review of !9998? — `y @deadbeef`\n'
      })
    )
    expect(plan.handled).toEqual([
      { onceKey: '1571:12cace69', status: 'done' },
      { onceKey: '1579:815b3867', status: 'done' },
      { onceKey: '1600:1e345678', status: 'started' }
    ])
    expect(plan.sessions).toEqual([])
  })
})
