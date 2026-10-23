import { describe, expect, it } from 'vitest'
import { automationTabTitle, isAutomationTabTitle } from './automation-tab-title'

describe('automationTabTitle', () => {
  it.each([
    { title: 'Fix CI · !1561', named: '[Automation] Fix CI · !1561' },
    // A name that already says so isn't said twice.
    { title: '[Automation] Fix CI · !1561', named: '[Automation] Fix CI · !1561' }
  ])('$title → $named', ({ title, named }) => {
    expect(automationTabTitle(title)).toBe(named)
    expect(isAutomationTabTitle(named)).toBe(true)
  })

  it.each([null, undefined, '', 'Fix CI · !1561', 'Automation · !1561', ' [Automation] Fix CI'])(
    'a tab named %j is no automation’s',
    (title) => {
      expect(isAutomationTabTitle(title)).toBe(false)
    }
  )
})
