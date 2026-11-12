import { describe, expect, it } from 'vitest'
import { automationEngine, pilotdOrigin } from '../../shared/automation-engine-settings'
import { pilotdHash } from './pilotd-engine'

describe('the automation engine setting', () => {
  it.each([
    [undefined, 'builtin'],
    ['builtin', 'builtin'],
    ['pilotd', 'pilotd'],
    ['orca', 'builtin']
  ])('saved %s is %s', (saved, engine) => {
    expect(automationEngine(saved)).toBe(engine)
  })

  it.each([
    [undefined, 'http://127.0.0.1:8787'],
    ['  ', 'http://127.0.0.1:8787'],
    ['http://127.0.0.1:9999/', 'http://127.0.0.1:9999'],
    ['https://mini.tail.ts.net/#overview', 'https://mini.tail.ts.net'],
    ['127.0.0.1:8787', null],
    ['javascript:alert(1)', null]
  ])('address %s opens at %s', (saved, origin) => {
    expect(pilotdOrigin(saved)).toBe(origin)
  })
})

describe("Pilot's views as pilotd's deep links", () => {
  it.each([
    ['automations', {}, '#automations'],
    ['automations', { automationId: '05 fix/ci' }, '#automations/05%20fix%2Fci'],
    ['running', { automationId: '05' }, '#running'],
    ['inbox', {}, '#inbox'],
    ['inbox', { cardId: 'c1' }, '#inbox/c1'],
    ['activity', {}, '#runs'],
    ['activity', { runId: 'r9' }, '#runs/r9'],
    ['usage', {}, '#usage'],
    ['playground', {}, null]
  ] as const)('%s %o is %s', (view, open, hash) => {
    expect(pilotdHash(view, open)).toBe(hash)
  })
})
