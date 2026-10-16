import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decideStep } from '../../src/shared/run/step-plan'
import type { PilotContext } from '../../src/main/pilot-services'
import { recordRunOutput } from '../../src/main/rpc/run-channel'
import { readMode } from '../../src/main/run/modes'
import { PilotStore } from '../../src/main/store/store'
import { renderTemplate } from '../../src/shared/template'
import { loadFixture } from './fixture'
import { answerFields, FIELD_SCRIPTS_09, JOB_09, PARITY_09, seed09 } from './jobs/job-09'
import { frozenOldPlan, PARITY_DIR } from './old-side'
import { describeParity, expectParity } from './parity-case'
import { caseFile, dryTick, loadPortedAutomation } from './ported'

const SKILLS = join(homedir(), '.agents', 'skills')
const { definition, people } = loadPortedAutomation(JOB_09.automationId)
// The findings file the agent writes, the card step reads and forget_findings removes, under the run's own folder.
const FINDINGS_DIR = '/Users/nishsitapara/Library/Caches/pilot-reviews/{run.id}'
const FINDINGS = `${FINDINGS_DIR}/findings.json`
// sweep.py's PREPARE_OPTIONS, which the Prepare card showed, pinned as literals now that sweep.py is gone.
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
    const head = { IID: '{mr.iid}', HEAD_SHA: '{mr.head_sha}' }
    expect(definition.steps).toMatchObject([
      {
        name: 'still_due',
        agent: 'shell',
        run: 'pilotcli gitlab check-mr "$IID" state=opened sha="$HEAD_SHA" reviewers=me unapproved=true',
        env: head,
        exitCodes: { ok: [0], skip: [], stop: [3] }
      },
      {
        name: 'checkout',
        agent: 'shell',
        run: 'pilotcli worktree create-review "$IID" --expect-sha "$HEAD_SHA"',
        env: head,
        exitCodes: { ok: [0], skip: [4, 5], stop: [3] }
      },
      { name: 'prepare', agent: 'claude', skill: 'review-mr', mode: 'prepare', always: false },
      {
        name: 'card',
        agent: 'shell',
        when: '{steps.prepare.findings} != null',
        run: 'pilotcli automations run-item review-requests "$IID" --findings "$FINDINGS"',
        env: { IID: '{mr.iid}', FINDINGS: FINDINGS },
        exitCodes: { ok: [0], skip: [3], stop: [] }
      },
      {
        name: 'forget_findings',
        agent: 'shell',
        always: true,
        run: 'rm -rf "$DIR"',
        env: { DIR: FINDINGS_DIR }
      }
    ])
    expect(definition.steps).toHaveLength(5)
  })

  it("the agent's prompt names the review worktree, how its checkout went and the findings file the card step reads", () => {
    const prompt = definition.steps.find((s) => s.name === 'prepare')?.prompt ?? ''
    for (const part of [
      '{steps.checkout.path}',
      '{steps.checkout.outcome}',
      '{steps.checkout.reason}',
      FINDINGS,
      '{run.answer}'
    ]) {
      expect([part, prompt.includes(part)]).toEqual([part, true])
    }
  })

  it('a head that moved, a closed MR, a dropped request or an approval since my Approve ends the run before the agent', () => {
    const [stillDue, checkout, prepare, card, forget] = definition.steps
    const stopped = [
      { name: stillDue.name, status: 'stopped' as const, always: false, error: 'sha moved' }
    ]
    for (const step of [checkout, prepare, card]) {
      expect([step.name, decideStep(step, stopped, {}).run]).toEqual([step.name, false])
    }
    expect(decideStep(forget, stopped, {})).toEqual({ run: true })
    const due = [{ name: stillDue.name, status: 'done' as const, always: false, error: null }]
    expect(decideStep(prepare, due, {})).toEqual({ run: true })
  })

  it("the checkout moving ends the run; a fork or a busy worktree still reaches the agent, in review-mr's own checkout", () => {
    const [stillDue, checkout, prepare] = definition.steps
    const due = { name: stillDue.name, status: 'done' as const, always: false, error: null }
    const ended = (status: 'stopped' | 'skipped') => [
      due,
      { name: checkout.name, status, always: false, error: null }
    ]
    expect(decideStep(prepare, ended('stopped'), {})).toMatchObject({ run: false })
    expect(decideStep(prepare, ended('skipped'), {})).toEqual({ run: true })
  })

  it('the card step posts only when the agent recorded its findings, and the findings file goes however the run ended', () => {
    const [, , prepare, card, forget] = definition.steps
    const ran = [{ name: prepare.name, status: 'done' as const, always: false, error: null }]
    expect(decideStep(card, ran, { 'steps.prepare.findings': 3 })).toEqual({ run: true })
    expect(decideStep(card, ran, { 'steps.prepare.findings': 0 })).toEqual({ run: true })
    expect(decideStep(card, ran, {})).toMatchObject({ run: false })
    const broke = [{ name: prepare.name, status: 'failed' as const, always: false, error: 'x' }]
    expect(decideStep(card, broke, { 'steps.prepare.findings': 3 })).toMatchObject({ run: false })
    expect(decideStep(forget, broke, {})).toEqual({ run: true })
  })

  it('reviews only requests of mine nobody approved: reviewer, not author, no approvals (unknown approvals fail closed)', () => {
    expect(definition.items?.where).toEqual({
      state: 'open',
      reviewer: { people: ['nish'] },
      author: { not: { people: ['nish'] } },
      approved_by: 'none'
    })
  })

  it("sends a revised Post card back to the asking session, else to review-mr's answers mode", () => {
    expect(definition.answers).toEqual({
      resume: 'asking_session',
      else: { agent: 'claude', skill: 'review-mr', mode: 'answers' }
    })
    // prepare records the findings count the card step's `when` reads; the card step posts the Post card. answers
    // declares post_card: an approved Prepare card imported from the vault runs prepare.md from its step 2 inside the
    // answer run, whose `pilot run output post_card=…` lands on that run.
    expect([modeOutputs('review-mr', 'prepare'), modeOutputs('review-mr', 'answers')]).toEqual([
      ['outcome', 'findings'],
      ['outcome', 'item_status', 'reply', 'post_card']
    ])
    expect(modeText('review-mr', 'prepare')).toContain(
      '~/.agents/skills/review-mr/modes/answers.md'
    )
    const answers = modeText('review-mr', 'answers')
    expect(answers).toContain('item_status=stale')
    expect(answers).toContain('An approved Prepare card (imported from the vault)')
    expect(answers).toContain(
      'Follow `~/.agents/skills/review-mr/modes/prepare.md` for !<iid> from its step 2'
    )
  })

  // What the declaration buys: Pilot takes post_card from an answers-mode run (read from the skill's real mode
  // file), and still refuses a name no mode declares.
  it('takes post_card from an answer run in review-mr answers mode, and refuses an undeclared output', () => {
    const store = PilotStore.open(':memory:')
    store.runs.create({
      id: 'ans-1',
      automationId: definition.id,
      tickId: null,
      itemKey: 'mr:1588',
      itemLabel: '!1588',
      worktreePath: null,
      startedAt: 1,
      trigger: 'answer'
    })
    store.runs.createStep({
      runId: 'ans-1',
      idx: 0,
      name: 'answers',
      agent: 'claude',
      skill: 'review-mr',
      mode: 'answers',
      startedAt: 1
    })
    const ctx = { store } as unknown as PilotContext
    const read = (skill: string, mode: string, path: string | null) =>
      readMode(skill, mode, path, homedir())
    const card = { post_card: 'in_0000000000000009', item_status: 'done', outcome: 'prepared' }
    expect(
      recordRunOutput(ctx, { runId: 'ans-1', stepIdx: 0, outputs: card }, read).outputs
    ).toEqual(card)
    expect(() =>
      recordRunOutput(ctx, { runId: 'ans-1', stepIdx: 0, outputs: { posted: 'yes' } }, read)
    ).toThrow("posted isn't one of them")
  })

  it('names no placeholder in a script, and every field script is pilotcli’s get-field', () => {
    expect(definition.items?.customFields.map((f) => [f.name, f.script])).toEqual([
      ['head8', FIELD_SCRIPTS_09.head8],
      ['card_context', FIELD_SCRIPTS_09.context]
    ])
    const scripts = [
      ...(definition.items?.customFields ?? []).map((f) => f.script),
      ...definition.steps.flatMap((s) => (s.agent === 'shell' ? [s.run ?? ''] : []))
    ]
    for (const script of scripts) {
      expect(script).not.toContain('{')
    }
  })
})

// review-requests' words (jobs/job_09.py, frozen in each case's old block with what `sweep.py field` printed) and the
// verdicts that agree with them, through the shared parity runner (parity-case.ts): a missed read, a tick error, a verdict
// mismatch or a case without frozen verdicts fails a case.
const CASES = join(PARITY_DIR, '09')
const cases = readdirSync(CASES)
  .filter((f) => f.endsWith('.json'))
  .sort()

describeParity(
  PARITY_09,
  '09 · Prepare reviews requested of me: parity with review-requests (frozen)',
  () => {
    const decide = (name: string) => {
      const fixture = loadFixture(caseFile(JOB_09.job, name))
      return dryTick({
        definition,
        people,
        fixture,
        seed: seed09,
        runScript: answerFields(fixture)
      })
    }

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
        const old = frozenOldPlan(caseFile(JOB_09.job, name)).filter((o) => o.decision === 'ask')
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
      const old = frozenOldPlan(join(CASES, name)).filter((d) => d.decision === 'skip')
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
        runScript: answerFields(unreadable)
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
