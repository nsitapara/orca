import { describe, expect, it } from 'vitest'
import { pinnedPages, sidebarNavPages, withPagePinned } from '../../shared/sidebar-pages-settings'
import { openSidebarPage } from './sidebar-pages'

describe('sidebar pages', () => {
  // Why: absent means the defaults (Inbox, Running, Automations), and a newer build's keys are dropped.
  it.each([
    { saved: undefined, pinned: ['inbox', 'running', 'automations'] },
    { saved: [], pinned: [] },
    { saved: ['playground', 'gone', 'tasks', 'tasks'], pinned: ['tasks', 'playground'] }
  ])('saved $saved pins $pinned', ({ saved, pinned }) => {
    expect(pinnedPages(saved)).toEqual(pinned)
  })

  it.each([
    { page: 'artifacts', pin: true, pinned: ['inbox', 'automations', 'artifacts'] },
    { page: 'inbox', pin: false, pinned: ['automations'] },
    { page: 'running', pin: true, pinned: ['inbox', 'running', 'automations'] }
  ] as const)('pinning $page=$pin keeps page order', ({ page, pin, pinned }) => {
    expect(withPagePinned(['automations', 'inbox'], page, pin)).toEqual(pinned)
  })

  it.each([
    { open: null, rows: ['inbox', 'automations'] },
    { open: 'artifacts', rows: ['inbox', 'automations', 'artifacts'] },
    { open: 'inbox', rows: ['inbox', 'automations'] }
  ] as const)('the open page $open joins the rows while open', ({ open, rows }) => {
    expect(sidebarNavPages(['inbox', 'automations'], open)).toEqual(rows)
  })

  it.each([
    { activeView: 'automations', view: 'automations', page: 'automations' },
    { activeView: 'automations', view: 'usage', page: 'automations' },
    { activeView: 'automations', view: 'inbox', page: 'inbox' },
    { activeView: 'automations', view: 'running', page: 'running' },
    { activeView: 'automations', view: 'playground', page: 'playground' },
    { activeView: 'tasks', view: 'inbox', page: 'tasks' },
    { activeView: 'artifacts', view: 'automations', page: 'artifacts' },
    { activeView: 'terminal', view: 'inbox', page: null },
    { activeView: 'skills', view: 'automations', page: null }
  ] as const)('$activeView ($view) is the $page page', ({ activeView, view, page }) => {
    expect(openSidebarPage(activeView, view)).toBe(page)
  })
})
