import { describe, expect, it } from 'vitest'
import { branchRepeatsHeader, titleWithoutIssueId } from './worktree-header-title'

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

describe('branchRepeatsHeader', () => {
  it.each([
    {
      branch: 'web-2640-allow-reuse-of-email',
      name: 'WEB-2640 Allow reuse of email',
      repeats: true
    },
    // Linear cuts a long name short, and drops punctuation.
    {
      branch: 'web-2640-set-the-familys',
      name: "Set the family's primary on new order",
      repeats: true
    },
    { branch: 'nish/web-2640-allow-reuse-of-email', name: 'Allow reuse of email', repeats: true },
    { branch: 'feat/usage-dashboard', name: 'usage-dashboard', id: null, repeats: true },
    { branch: 'fix/carrier-amend-flow', name: 'Carrier screening: amend a report', repeats: false },
    { branch: 'web-2640-second-attempt', name: 'Allow reuse of email', repeats: false },
    { branch: 'main', name: 'usage-dashboard', id: null, repeats: false }
  ])('$branch under "$name" repeats it: $repeats', ({ branch, name, id, repeats }) => {
    expect(branchRepeatsHeader(branch, name, id === undefined ? 'WEB-2640' : id)).toBe(repeats)
  })
})
