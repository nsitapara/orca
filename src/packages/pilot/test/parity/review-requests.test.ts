import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderTemplate } from '../../src/shared/template'
import { loadFixture } from './fixture'
import { JOB_09, PARITY_09, runFieldScript, seed09 } from './jobs/job-09'
import { PARITY_DIR, runOldPlan } from './old-side'
import { describeParity, expectParity } from './parity-case'
import { caseFile, dryTick, loadPortedAutomation } from './ported'

const SKILLS = join(homedir(), '.agents', 'skills')
const { definition, people } = loadPortedAutomation(JOB_09.automationId)
// sweep.py's PREPARE_OPTIONS, which the Prepare card showed.
const PREPARE_OPTIONS = [
  'Approve — check the branch out in a worktree and prepare the review there; nothing posts yet',
  "Skip — don't review this head"
]

function modeText(skill: string, mode: string): string {
  return readFileSync(join(SKILLS, skill, 'modes', `${mode}.md`), 'utf8')
}

function modeOutputs(skill: string, mode: string): string[] {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(modeText(skill, mode))?.[1] ?? ''
  const list = /^outputs: \[(.*)\]$/m.exec(front)?.[1] ?? ''
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

describe('09 · Prepare reviews requested of me: the definition', () => {
  it('asks first, once per MR and 8-character head, in the main checkout, spending no quota to ask', () => {
    expect(definition).toMatchObject({
      name: '09 · Prepare reviews requested of me',
      schedule: '30 * * * *',
      enabled: false,
      missedRunGraceMs: 12 * 3_600_000,
      oncePer: '{mr.iid}:{mr.head8}',
      start: 'ask_first',
      askFirst: {
        title: 'Prepare a review of !{mr.iid}?',
        context: '{mr.card_context}',
        options: PREPARE_OPTIONS
      },
      workspace: { kind: 'main_checkout' },
      checks: [],
      powers: ['post'],
      inbox: 'nish'
    })
    expect(definition.items?.customFields.map((f) => [f.name, f.cache])).toEqual([
      ['head8', 'per_head'],
      ['card_context', 'per_tick']
    ])
    expect(definition.steps).toMatchObject([
      { name: 'prepare', agent: 'claude', skill: 'review-mr', mode: 'prepare' }
    ])
  })

  it('reviews only requests of mine nobody approved: reviewer, not author, no approvals (unknown approvals fail closed)', () => {
    expect(definition.items?.where).toEqual({
      state: 'open',
      reviewer: { people: ['nish'] },
      author: { not: { people: ['nish'] } },
      approved_by: 'none'
    })
  })

  it("words the card's options as the sweep did", () => {
    const sweep = readFileSync(join(SKILLS, 'review-requests', 'sweep.py'), 'utf8')
    for (const option of PREPARE_OPTIONS) {
      expect(sweep).toContain(option)
    }
  })

  it("sends a revised Post card back to the asking session, else to review-mr's answers mode", () => {
    expect(definition.answers).toEqual({
      resume: 'asking_session',
      else: { agent: 'claude', skill: 'review-mr', mode: 'answers' }
    })
    expect([modeOutputs('review-mr', 'prepare'), modeOutputs('review-mr', 'answers')]).toEqual([
      ['outcome', 'post_card'],
      ['outcome', 'item_status', 'reply']
    ])
    expect(modeText('review-mr', 'prepare')).toContain(
      '~/.agents/skills/review-mr/modes/answers.md'
    )
    expect(modeText('review-mr', 'answers')).toContain('item_status=stale')
  })

  it('names no placeholder in a script, and every field script is the skill’s own `sweep.py field`', () => {
    for (const f of definition.items?.customFields ?? []) {
      expect(f.script).toMatch(/review-requests\/sweep\.py field (head8|context)$/)
    }
  })
})

// review-requests' words (jobs/job_09.py) and the verdicts that agree with them, through the shared parity runner
// (parity-case.ts): a missed read, a tick error or a verdict mismatch fails a case.
const CASES = join(PARITY_DIR, '09')
const cases = readdirSync(CASES)
  .filter((f) => f.endsWith('.json'))
  .sort()

describeParity(
  PARITY_09,
  '09 · Prepare reviews requested of me: parity with review-requests',
  () => {
    const decide = (name: string) =>
      dryTick({
        definition,
        people,
        fixture: loadFixture(caseFile(JOB_09.job, name)),
        seed: seed09,
        runScript: runFieldScript
      })

    it.each(cases)(
      '%s: every review request gets the verdict the sweep gave it, from reads the case holds',
      async (name) => {
        await expectParity(PARITY_09, join(CASES, name))
      }
    )

    it('requests: 1571 (new head since its Skip) and 1600 (draft) are asked; 1579 was prepared already', async () => {
      const neu = await decide('requests')
      expect(neu.find((d) => d.key === 'mr:1571')).toMatchObject({
        verdict: 'asked',
        onceKey: '1571:2b7e4c90'
      })
      expect(neu.find((d) => d.key === 'mr:1600')).toMatchObject({
        verdict: 'asked',
        onceKey: '1600:1e345678'
      })
      expect(neu.find((d) => d.key === 'mr:1579')).toMatchObject({
        verdict: 'notdue',
        onceKey: '1579:815b3867'
      })
      expect(neu.filter((d) => d.verdict === 'out_of_scope').map((d) => d.key)).toEqual([
        'mr:1580',
        'mr:1588',
        'mr:1592'
      ])
      expect(neu.find((d) => d.key === 'mr:1601')).toBeUndefined()
    })

    it('an asked card reads exactly like the old Prepare card', async () => {
      for (const name of cases.map((c) => c.replace(/\.json$/, ''))) {
        const neu = await decide(name)
        const old = runOldPlan(JOB_09.job, caseFile(JOB_09.job, name)).filter(
          (o) => o.decision === 'ask'
        )
        for (const o of old) {
          const d = neu.find((n) => n.key === o.key)
          expect(d?.verdict).toBe('asked')
          expect(renderTemplate(definition.askFirst!.title, d!.fields).text).toBe(
            `Prepare a review of !${o.key.slice(3)}?`
          )
          expect(renderTemplate(definition.askFirst!.context, d!.fields).text).toBe(o.reason)
        }
      }
    })

    it('many: no cap on asks, as the sweep had none', async () => {
      const neu = await decide('many')
      expect(neu.filter((d) => d.verdict === 'asked')).toHaveLength(6)
    })

    // The skip reasons, not only verdicts: the sweep's "your own MR" and approvals map to the engine's scope reasons.
    it.each(cases)('%s: each skip is for the reason the sweep gave', async (name) => {
      const byReason: [RegExp, RegExp][] = [
        [/^your own MR$/, /author/i],
        [/^you approved it$/, /^Approved by /],
        [/^approved by /, /^Approved by /]
      ]
      const neu = await decide(name.replace(/\.json$/, ''))
      const old = runOldPlan(JOB_09.job, join(CASES, name)).filter((d) => d.decision === 'skip')
      for (const d of old) {
        const expected = byReason.find(([re]) => re.test(d.reason))?.[1]
        expect(expected, d.reason).toBeDefined()
        expect([d.key, neu.find((n) => n.key === d.key)?.reason]).toEqual([
          d.key,
          expect.stringMatching(expected!)
        ])
      }
    })

    // 09 never prepares a review of an approved MR, so an approval nobody could read counts as one.
    it('requests: an MR whose approvals cannot be read is not offered', async () => {
      const f = loadFixture(caseFile(JOB_09.job, 'requests'))
      const unreadable = {
        ...f,
        reads: f.reads.filter((r) => !r.argv.join(' ').endsWith('merge_requests/1571/approvals'))
      }
      const neu = await dryTick({
        definition,
        people,
        fixture: unreadable,
        seed: seed09,
        runScript: runFieldScript
      })
      expect(neu.find((d) => d.key === 'mr:1571')).toMatchObject({
        verdict: 'out_of_scope',
        reason: expect.stringContaining("Approvals couldn't be read")
      })
    })

    // Order of reasons: the sweep names my own MR before any approval.
    it('order: a head already offered stays offered, a new head asks again, and an approval beats a later head', async () => {
      const neu = await decide('order')
      const verdicts = Object.fromEntries(neu.map((d) => [d.key, d.verdict]))
      expect(verdicts).toEqual({
        'mr:1810': 'out_of_scope',
        'mr:1811': 'out_of_scope',
        'mr:1812': 'out_of_scope',
        'mr:1813': 'notdue',
        'mr:1814': 'asked'
      })
    })
  }
)
