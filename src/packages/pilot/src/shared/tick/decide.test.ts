import { describe, expect, it } from 'vitest'
import { parseAutomationYaml } from '../definition/parse'
import { parsePeopleYaml } from '../people'
import type { TickItem } from '../api-types'
import { decideTick } from './decide'
import { fixture } from './__fixtures__/ci-05-2026-10-10'

const CI_05 = `
name: Fix failed CI on my MRs
repo: web-platform
schedule: "10 * * * *"
items:
  kind: merge_request
  where: { state: open, author: { people: [nish] }, head_pipeline: failed }
once_per: "{mr.iid}:{mr.pipeline}"
checks: [ { worktree: exists }, { worktree: clean }, { session: none_open }, quota ]
limits: { per_tick: 3 }
steps: [ { agent: claude, skill: fix-gitlab-ci, prompt: "Fix {mr.pipeline} on !{mr.iid}" } ]
`
const PEOPLE = `
people:
  - { id: nish, name: Nish Sitapara, gitlab: nish8 }
  - { id: shivan, name: Shivan, gitlab: shivan2418 }
`

function setup(yaml = CI_05) {
  const def = parseAutomationYaml(yaml, '/a/fix-failed-ci.yaml')
  const people = parsePeopleYaml(PEOPLE)
  if (!def.ok || !people.ok) {
    throw new Error('fixture setup failed')
  }
  return { definition: def.definition, people: people.directory }
}

describe('decideTick on 2026-10-10 12:10 (automation 05)', () => {
  it('matches what the old sweep decided, item by item', () => {
    const { definition, people } = setup()
    const decisions = decideTick({
      definition,
      people,
      items: fixture.items,
      handledKeys: new Set(fixture.handledKeys),
      seenKeys: new Set(),
      runningCount: 0
    })
    expect(decisions.map((d) => [d.key, d.verdict, d.reason])).toEqual([
      ['!1561', 'started', 'All checks pass'],
      ['!1587', 'notdue', 'Already handled 1587:2933991087'],
      ['!1574', 'skipped', '2 uncommitted files'],
      ['!1592', 'skipped', 'A session from this automation is still open there'],
      ['!1347', 'notdue', 'Head pipeline success'],
      ['!1590', 'notdue', 'Head pipeline running'],
      ['!1588', 'out_of_scope', 'Author is Shivan; this automation looks at Nish Sitapara'],
      ['!1600', 'out_of_scope', "Author contractor9 isn't in people.yaml"]
    ])
    expect(decisions[0].onceKey).toBe('1561:2934410022')
    expect(decisions[0].checks.map((c) => c.ok)).toEqual([true, true, true, true])
  })

  it('stops starting at the per-tick limit', () => {
    const { definition, people } = setup(CI_05.replace('per_tick: 3', 'per_tick: 1'))
    const items = fixture.items.map((i) => ({
      ...i,
      fields: { ...i.fields, 'worktree.dirty_count': 0, 'session.open_from_automation': false }
    }))
    const verdicts = decideTick({
      definition,
      people,
      items,
      handledKeys: new Set(),
      seenKeys: new Set(),
      runningCount: 0
    }).map((d) => d.verdict)
    expect(verdicts.slice(0, 4)).toEqual(['started', 'over_limit', 'over_limit', 'over_limit'])
  })

  it('baselines items it has never seen when first_seen is baseline', () => {
    const { definition, people } = setup(CI_05.replace('limits:', 'first_seen: baseline\nlimits:'))
    const first = decideTick({
      definition,
      people,
      items: fixture.items.slice(0, 1),
      handledKeys: new Set(),
      seenKeys: new Set(),
      runningCount: 0
    })
    expect(first[0]).toMatchObject({
      verdict: 'baselined',
      reason: 'First time seen: recorded, not acted on'
    })
  })

  it('treats an author missing from people.yaml as in scope under author: anyone', () => {
    const { definition, people } = setup(CI_05.replace('{ people: [nish] }', 'anyone'))
    const contractor = fixture.items.filter((i) => i.key === '!1600')
    const [d] = decideTick({
      definition,
      people,
      items: contractor,
      handledKeys: new Set(),
      seenKeys: new Set(),
      runningCount: 0
    })
    expect(d).toMatchObject({ verdict: 'skipped', reason: 'No worktree for branch web-2200-x' })
  })

  it('starts nothing twice in one tick: same once_per key, same worktree', () => {
    const { definition, people } = setup()
    const first = fixture.items[0]
    const run = (items: TickItem[]) =>
      decideTick({
        definition,
        people,
        items,
        handledKeys: new Set(),
        seenKeys: new Set(),
        runningCount: 0
      })
    const dupKey = run([first, { ...first, key: '!9999', label: '!9999 dup' }])
    expect(dupKey.map((d) => [d.verdict, d.reason])).toEqual([
      ['started', 'All checks pass'],
      ['notdue', 'Already handled 1561:2934410022']
    ])
    const otherPipeline = { ...first.fields, 'mr.iid': 9999, 'mr.pipeline': 1 }
    const sameTree = run([first, { ...first, key: '!9999', fields: otherPipeline }])
    expect(sameTree.map((d) => [d.verdict, d.reason])).toEqual([
      ['started', 'All checks pass'],
      ['skipped', 'Another run starts in /wt/web-1493 this tick']
    ])
  })

  it('counts running agents against the at-once limit', () => {
    const { definition, people } = setup(CI_05.replace('per_tick: 3', 'at_once: 2'))
    const [d] = decideTick({
      definition,
      people,
      items: fixture.items.slice(0, 1),
      handledKeys: new Set(),
      seenKeys: new Set(),
      runningCount: 2
    })
    expect(d).toMatchObject({ verdict: 'over_limit', reason: 'At most 2 at once' })
  })

  it('scopes out MRs that are not open and names missing facts as unknown', () => {
    const { definition, people } = setup()
    const merged = {
      ...fixture.items[0],
      fields: { ...fixture.items[0].fields, 'mr.state': 'merged' }
    }
    const { 'mr.author': _a, ...noAuthor } = fixture.items[0].fields
    const items = [merged, { ...fixture.items[0], fields: noAuthor }]
    const out = decideTick({
      definition,
      people,
      items,
      handledKeys: new Set(),
      seenKeys: new Set(),
      runningCount: 0
    })
    expect(out.map((d) => [d.verdict, d.reason])).toEqual([
      ['out_of_scope', 'MR is merged'],
      ['out_of_scope', "Author (unknown) isn't in people.yaml"]
    ])
  })

  it('absent author filter behaves like anyone', () => {
    const { definition, people } = setup(CI_05.replace('author: { people: [nish] }, ', ''))
    const contractor = fixture.items.filter((i) => i.key === '!1600')
    const [d] = decideTick({
      definition,
      people,
      items: contractor,
      handledKeys: new Set(),
      seenKeys: new Set(),
      runningCount: 0
    })
    expect(d).toMatchObject({ verdict: 'skipped', reason: 'No worktree for branch web-2200-x' })
  })
})
