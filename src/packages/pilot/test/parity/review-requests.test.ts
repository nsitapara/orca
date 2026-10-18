import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { StepDef } from '../../src/shared/definition/types'
import { decideStep, type EndedStep } from '../../src/shared/run/step-plan'
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
// The guide file the agent writes, the guide step reads and forget_guide removes, under the run's own folder.
const GUIDE_DIR = '/Users/nishsitapara/Library/Caches/pilot-reviews/{run.id}'
const GUIDE = `${GUIDE_DIR}/guide.json`
// The Prepare card's options: every one but Skip starts the run, and {run.choice} says which (the env step's stack).
const PREPARE_OPTIONS = [
  'Backend — review and test it, on a backend stack when the branch changes api/; nothing posts',
  'Full stack + UI — also bring up the frontends and drive the changed screens; nothing posts',
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

function stepNamed(name: string): StepDef {
  const step = definition.steps.find((s) => s.name === name)
  if (!step) {
    throw new Error(`no step ${name}`)
  }
  return step
}

const ended = (name: string, status: EndedStep['status'], always = false): EndedStep => ({
  name,
  status,
  always,
  error: null
})

describe('09 · Prepare reviews requested of me: the definition', () => {
  it('asks first, once per MR and 8-character head, in the main checkout, and may post nothing', () => {
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
      powers: [],
      inbox: 'nish'
    })
    expect(definition.limits).toMatchObject({ atOnce: 1, timeoutMs: 100 * 60_000 })
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
      {
        name: 'env',
        agent: 'shell',
        env: {
          RUN: '{run.id}',
          BRANCH: '{mr.branch}',
          HEAD_SHA: '{mr.head_sha}',
          CHOICE: '{run.choice}'
        },
        exitCodes: { ok: [0], skip: [1], stop: [] }
      },
      { name: 'prepare', agent: 'claude', skill: 'review-mr', mode: 'prepare', always: false },
      {
        name: 'guide',
        agent: 'shell',
        when: "{steps.prepare.guide} == 'written'",
        run: 'pilotcli automations run-item review-requests "$IID" --guide "$GUIDE"',
        env: { IID: '{mr.iid}', GUIDE },
        exitCodes: { ok: [0], skip: [3], stop: [] }
      },
      {
        name: 'teardown',
        agent: 'shell',
        always: true,
        when: "{steps.env.outcome} == 'ok'",
        run: 'pilotcli env delete "$RUN"',
        env: { RUN: '{run.id}' }
      },
      {
        name: 'forget_guide',
        agent: 'shell',
        always: true,
        run: 'rm -rf "$DIR"',
        env: { DIR: GUIDE_DIR }
      }
    ])
    expect(definition.steps).toHaveLength(7)
  })

  // The env step's script, run in a shell: Full stack + UI is a full stack, anything else a backend one when the
  // branch changes api/ (pilotcli's own rule).
  it.each([
    ['Full stack + UI', 'full'],
    ['Backend', 'when-backend'],
    ['', 'when-backend']
  ])('the env step makes a test env for the choice %j: --stack %s', (choice, stack) => {
    const bin = mkdtempSync(join(tmpdir(), 'pilot-09-env-'))
    const log = join(bin, 'argv')
    writeFileSync(join(bin, 'pilotcli'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}"\n`, {
      mode: 0o755
    })
    execFileSync('/bin/sh', ['-c', stepNamed('env').run ?? ''], {
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        RUN: 'r1',
        BRANCH: 'web-2115',
        HEAD_SHA: 'a'.repeat(40),
        CHOICE: choice
      }
    })
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
      'env',
      'create',
      '--run',
      'r1',
      '--branch',
      'web-2115',
      '--at',
      'a'.repeat(40),
      '--stack',
      stack
    ])
  })

  it("the agent's prompt names the choice, the test env, the review worktree, the guide file and my notes", () => {
    const prompt = stepNamed('prepare').prompt ?? ''
    for (const part of [
      '{run.choice}',
      '{steps.env.path}',
      '{steps.env.outcome}',
      '{steps.env.reason}',
      '{steps.checkout.path}',
      '{steps.checkout.outcome}',
      '{steps.checkout.reason}',
      GUIDE,
      '{run.answer}'
    ]) {
      expect([part, prompt.includes(part)]).toEqual([part, true])
    }
  })

  it('a head that moved, a closed MR, a dropped request or an approval since my Approve ends the run before anything is made', () => {
    const stopped = [ended('still_due', 'stopped')]
    for (const name of ['checkout', 'env', 'prepare', 'guide', 'teardown']) {
      expect([name, decideStep(stepNamed(name), stopped, {}).run]).toEqual([name, false])
    }
    expect(decideStep(stepNamed('forget_guide'), stopped, {})).toEqual({ run: true })
    expect(decideStep(stepNamed('env'), [ended('still_due', 'done')], {})).toEqual({ run: true })
  })

  it('the checkout moving ends the run; a fork or a busy worktree still gets its test env and reaches the agent', () => {
    const due = ended('still_due', 'done')
    expect(decideStep(stepNamed('env'), [due, ended('checkout', 'stopped')], {})).toMatchObject({
      run: false
    })
    const skipped = [due, ended('checkout', 'skipped')]
    expect(decideStep(stepNamed('env'), skipped, {})).toEqual({ run: true })
    expect(decideStep(stepNamed('prepare'), [...skipped, ended('env', 'done')], {})).toEqual({
      run: true
    })
  })

  it('a stack that failed (env skipped) still reaches the agent, and leaves nothing to tear down', () => {
    const run = [ended('still_due', 'done'), ended('checkout', 'done'), ended('env', 'skipped')]
    expect(decideStep(stepNamed('prepare'), run, {})).toEqual({ run: true })
    const after = [...run, ended('prepare', 'done'), ended('guide', 'done')]
    expect(
      decideStep(stepNamed('teardown'), after, { 'steps.env.outcome': 'failed' })
    ).toMatchObject({ run: false })
  })

  it('the guide step runs only when the agent wrote the guide; the env and the guide file go however the run ended', () => {
    const ran = [ended('env', 'done'), ended('prepare', 'done')]
    expect(decideStep(stepNamed('guide'), ran, { 'steps.prepare.guide': 'written' })).toEqual({
      run: true
    })
    expect(decideStep(stepNamed('guide'), ran, {})).toMatchObject({ run: false })
    const broke = [ended('env', 'done'), { ...ended('prepare', 'failed'), error: 'x' }]
    const fields = { 'steps.prepare.guide': 'written', 'steps.env.outcome': 'ok' }
    expect(decideStep(stepNamed('guide'), broke, fields)).toMatchObject({ run: false })
    expect(decideStep(stepNamed('teardown'), broke, fields)).toEqual({ run: true })
    expect(decideStep(stepNamed('forget_guide'), broke, {})).toEqual({ run: true })
  })

  it('reviews only requests of mine nobody approved: reviewer, not author, no approvals (unknown approvals fail closed)', () => {
    expect(definition.items?.where).toEqual({
      state: 'open',
      reviewer: { people: ['nish'] },
      author: { not: { people: ['nish'] } },
      approved_by: 'none'
    })
  })

  it("sends a follow-up on the guide card back to the asking session, else to review-mr's answers mode", () => {
    expect(definition.answers).toEqual({
      resume: 'asking_session',
      else: { agent: 'claude', skill: 'review-mr', mode: 'answers' }
    })
    // prepare records guide=written, which the guide step's `when` reads; the guide step posts the guide card. answers
    // declares guide_card: a follow-up writes the next version itself and records it with `pilot run output guide_card=…`.
    expect([modeOutputs('review-mr', 'prepare'), modeOutputs('review-mr', 'answers')]).toEqual([
      ['outcome', 'guide'],
      ['outcome', 'item_status', 'reply', 'guide_card']
    ])
    expect(modeText('review-mr', 'prepare')).toContain(
      '~/.agents/skills/review-mr/modes/answers.md'
    )
    const answers = modeText('review-mr', 'answers')
    expect(answers).toContain('item_status=stale')
    expect(answers).toContain('pilot run output guide_card=<data.guide_card>')
  })

  // What the declaration buys: Pilot takes guide_card from an answers-mode run (read from the skill's real mode
  // file), and still refuses a name no mode declares.
  it('takes guide_card from an answer run in review-mr answers mode, and refuses an undeclared output', () => {
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
    const card = { guide_card: 'in_0000000000000009', item_status: 'done', outcome: 'prepared' }
    expect(
      recordRunOutput(ctx, { runId: 'ans-1', stepIdx: 0, outputs: card }, read).outputs
    ).toEqual(card)
    expect(() =>
      recordRunOutput(ctx, { runId: 'ans-1', stepIdx: 0, outputs: { post_card: 'x' } }, read)
    ).toThrow("post_card isn't one of them")
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

// review-requests' words (frozen in each case's old block with what `sweep.py field` printed) and the
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
