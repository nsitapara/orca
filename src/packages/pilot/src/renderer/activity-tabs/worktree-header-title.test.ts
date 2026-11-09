import { describe, expect, it } from 'vitest'
import { titleWithoutIssueId } from './worktree-header-title'

describe('titleWithoutIssueId', () => {
  it.each([
    {
      name: 'WEB-2637 Use the same SNV classifications',
      id: 'WEB-2637',
      title: 'Use the same SNV classifications'
    },
    { name: 'web-2640: Allow reuse of email', id: 'WEB-2640', title: 'Allow reuse of email' },
    { name: 'WEB-2642 – Fix hourly e2e failure', id: 'WEB-2642', title: 'Fix hourly e2e failure' },
    { name: 'WEB-26370 Another ticket', id: 'WEB-2637', title: 'WEB-26370 Another ticket' },
    { name: 'Fix the build for WEB-2637', id: 'WEB-2637', title: 'Fix the build for WEB-2637' },
    { name: 'WEB-2637', id: 'WEB-2637', title: 'WEB-2637' },
    { name: 'WEB-2637 Use the same', id: null, title: 'WEB-2637 Use the same' }
  ])('$name with chip $id reads "$title"', ({ name, id, title }) => {
    expect(titleWithoutIssueId(name, id)).toBe(title)
  })
})
