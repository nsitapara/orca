import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ItemFields } from '../../src/shared/api-types'
import { answerEnvOf } from '../../src/main/answers/answer-env'
import { loadDefinitions } from '../../src/main/definitions/loader'
import { shellEnding } from '../../src/main/run/shell-ending'
import { envCreateArgs, holdsWorktree, resolveEnv } from '../../src/shared/run/env-args'
import { renderShellEnv, runPlaceholders } from '../../src/shared/run/shell-template'
import { decideStep, type EndedStep } from '../../src/shared/run/step-plan'
import { readStepResult } from '../../src/shared/run/step-result'
import { loadPortedAutomation, portedAutomationsDir } from './ported'

const SKILL = join(homedir(), '.agents', 'skills', 'ui-qa')
const YAML = join(portedAutomationsDir(), 'ui-qa-overnight.yaml')
const HOUR = 3_600_000
const MINUTE = 60_000
// No permission flag: Pilot's Codex command carries Settings' (agentDefaultArgs), and Codex refuses it twice.
const CODEX_ARGS = ['-c', 'check_for_update_on_startup=false']
const SHA = 'c'.repeat(40)

function modeOutputs(mode: string): string[] {
  const text = readFileSync(join(SKILL, 'modes', `${mode}.md`), 'utf8')
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ''
  const list = /^outputs: \[(.*)\]$/m.exec(front)?.[1] ?? ''
  return list
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function load() {
  return loadPortedAutomation('ui-qa-overnight').definition
}

function step(name: string) {
  const found = load().steps.find((s) => s.name === name)
  if (!found) {
    throw new Error(`no step ${name}`)
  }
  return found
}

// A shell step as the engine stores it: its line, env, exit codes, timeout and home hold.
function shellOf(name: string) {
  const { run, env, exitCodes, timeoutMs, holdHome } = step(name)
  return { run, env, exitCodes, timeoutMs, holdHome }
}

// Whether a step runs after the steps before it ended so, with these fields (the engine's own rule, decideStep).
function runs(name: string, ended: EndedStep[], fields: ItemFields): boolean {
  return decideStep(step(name), ended, fields).run
}

const ok = (name: string): EndedStep => ({
  name,
  status: 'done',
  always: step(name).always,
  error: null
})
const broke = (name: string): EndedStep => ({
  name,
  status: 'failed',
  always: step(name).always,
  error: null
})
const late = (name: string): EndedStep => ({
  name,
  status: 'timed_out',
  always: step(name).always,
  error: null
})
const unrun = (name: string): EndedStep => ({
  name,
  status: 'skipped',
  always: step(name).always,
  error: null
})

// A pilotcli step that exited with this code and envelope, as shellEnding settles it by the step's own exit_codes.
function exited(name: string, code: number, outcome: string): EndedStep {
  const stdout = JSON.stringify({ v: 1, command: name, outcome, reason: '', data: {} })
  const result = { code, signal: null, stdout, stderr: '', timedOut: false }
  const { status, error } = shellEnding(
    step(name),
    result,
    step(name).timeoutMs,
    readStepResult(stdout)
  )
  return { name, status, always: step(name).always, error }
}

// Old: Orca automation 736981a0 "04 · Test branch UIs overnight", rrule "*/20 2-7 * * *" in America/Los_Angeles, a
// 20-minute missed-run grace, precheck `loop.py sweep` (600 s), which started one run at a time inside 02:00-05:59,
// the longest-waiting due worktree first, 60 minutes per session. Since pilotCLI milestone 8b (spec §7.10.2) the night
// runs on pilotcli in a throwaway with its own full stack; no Python is left.
describe.skipIf(!existsSync(SKILL))(
  '04 · Test branch UIs overnight: the definition (old job: orca automation 736981a0; pilotcli chain since milestone 8b)',
  () => {
    // The window, the 60 minutes and the 12 hours are the YAML's own now: common.py went with the Python.
    it("keeps the sweep's schedule, one run at a time in the start window, and its 12-hour retry", () => {
      expect(load()).toMatchObject({
        name: '04 · Test branch UIs overnight',
        schedule: '*/20 2-7 * * *',
        timezone: 'America/Los_Angeles',
        missedRunGraceMs: 20 * MINUTE,
        firstSeen: 'baseline',
        oncePer: '{worktree.at_head}',
        retryAfterFailureMs: 12 * HOUR,
        limits: { perTick: 1, atOnce: 1, timeoutMs: HOUR, order: 'oldest_waiting_first' },
        powers: ['commit', 'push'],
        inbox: 'nish'
      })
      expect(load().checks).toContainEqual({ kind: 'window', start: '02:00', end: '05:59' })
    })

    // Spec §7.10.2: `at:` always makes a throwaway, detached at the once_per head, with its own full stack; with `at:`
    // Pilot holds nothing beforehand.
    it('works in a throwaway of my worktree at the once_per head, with its own full stack', () => {
      const workspace = load().workspace
      expect(workspace).toEqual({
        kind: 'env',
        subject: { kind: 'worktree', worktree: '{worktree.path}', at: '{worktree.head}' },
        writes: true,
        stack: 'full'
      })
      if (workspace.kind !== 'env') {
        throw new Error('not an env workspace')
      }
      const fields = {
        'worktree.path': '/wt/web-1',
        'worktree.head': SHA,
        'worktree.at_head': `repo::/wt/web-1@${SHA}`
      }
      const env = resolveEnv(workspace, fields, 'web-1')
      expect(holdsWorktree(env.subject)).toBe(false)
      expect(
        envCreateArgs({ runId: 'ui-qa-overnight-1', env, throwaway: null, dryRun: false })
      ).toEqual([
        'env',
        'create',
        '--run',
        'ui-qa-overnight-1',
        '--worktree',
        '/wt/web-1',
        '--at',
        SHA, // the sha of {worktree.at_head}, the once_per key
        '--writes',
        'true',
        '--stack',
        'full',
        '--format',
        'json'
      ])
    })

    it('lists my worktrees with new own commits, testing a first sight with recent work, and checks them in due.decide’s order', () => {
      expect(load().items).toMatchObject({
        kind: 'worktree',
        where: { branch_owner: { people: ['nish'] }, commits: { first_sight: 'test_recent' } }
      })
      // The worktree kind doesn't leave out a merged or closed MR's branch itself, so not_merged stays a check.
      expect(load().checks).toEqual([
        {
          kind: 'field',
          expr: '{worktree.git_operation} == null',
          reason: 'A merge, rebase or git lock is in progress; retry next tick'
        },
        { kind: 'mr', rule: 'not_merged' },
        { kind: 'mr', rule: 'not_approved' },
        { kind: 'answers_none_pending' },
        { kind: 'worktree_idle' },
        { kind: 'window', start: '02:00', end: '05:59' },
        { kind: 'quota', agent: 'codex', weekly: 90, session: 95 }
      ])
    })

    it("runs pilotcli's context, the QA session, its page's close and pilotcli's report, the flags, the verdict, then the fixer and its merge back", () => {
      expect(load().steps.map((s) => [s.name, s.agent, s.always])).toEqual([
        ['context', 'shell', false],
        ['test', 'codex', true],
        ['close_page', 'shell', true],
        ['report', 'shell', true],
        ['flag', 'shell', true],
        ['flag_failed', 'shell', true],
        ['verdict', 'shell', false],
        ['fix', 'claude', true],
        ['merge_back', 'shell', false],
        ['flag_held', 'shell', true],
        ['forget_branch', 'shell', true]
      ])
      // The session's 60 minutes is get-context's deadline too (a Go constant, spec §7.10.3).
      expect(step('test')).toMatchObject({
        skill: 'ui-qa',
        mode: 'run',
        args: CODEX_ARGS,
        when: "{steps.context.outcome} == 'ok'",
        timeoutMs: HOUR
      })
      for (const field of ['{env.path}', '{env.sha}', '{steps.context.result}']) {
        expect(step('test').prompt).toContain(field)
      }
      // No --permission-mode: Pilot's Claude command already carries --dangerously-skip-permissions, which Claude
      // Code ranks above it, so an acceptEdits here never took effect.
      expect(step('fix')).toMatchObject({
        skill: 'ui-qa',
        mode: 'fix',
        args: [],
        when: '{steps.report.fix} == true',
        timeoutMs: 90 * MINUTE
      })
      for (const field of ['{env.path}', '{worktree.path}', '{steps.report.result}']) {
        expect(step('fix').prompt).toContain(field)
      }
    })

    it("calls pilotcli's context, report, merge back and branch cleanup with these lines and env", () => {
      expect(shellOf('context')).toEqual({
        run: 'pilotcli skills get-context ui-qa . --worktree "$DIR" --base "$SINCE" --head "${AT_HEAD##*@}" --first-sight "$FIRST" --base-ref "$BASE_REF"',
        env: {
          DIR: '{worktree.path}',
          SINCE: '{worktree.since}',
          AT_HEAD: '{worktree.at_head}',
          FIRST: '{worktree.first_sight}',
          BASE_REF: '{worktree.base_ref?}' // null on every night with a marker
        },
        exitCodes: { ok: [0], skip: [], stop: [3] },
        timeoutMs: 2 * MINUTE,
        holdHome: false
      })
      expect(shellOf('report')).toEqual({
        run: 'printf %s "$CONTEXT" | pilotcli skills create-report ui-qa --context - --test "$TEST" --said "$SAID"',
        // The session's outcome survives its timeout (§7.10.13 (a)); one it never said renders "".
        env: {
          CONTEXT: '{steps.context.result}',
          TEST: '{steps.test.status}',
          SAID: '{steps.test.outcome?}'
        },
        exitCodes: { ok: [0], skip: [], stop: [] },
        timeoutMs: 10 * MINUTE,
        holdHome: false
      })
      // pilotcli refuses a bare bool, so --merge takes `true`. $PILOT_HOME_BUSY is Pilot's, set only under hold_home.
      expect(shellOf('merge_back')).toEqual({
        run: 'pilotcli git update-branch "$HOME_WT" --merge true --to "$(git rev-parse HEAD)" --busy "$PILOT_HOME_BUSY"',
        env: { HOME_WT: '{worktree.path}' },
        exitCodes: { ok: [0], skip: [3], stop: [] },
        timeoutMs: 5 * MINUTE,
        holdHome: true
      })
      // The keep branch is the one fix.md has the fixer move after each commit: pilot/ui-qa-$PILOT_RUN_ID.
      expect(shellOf('forget_branch')).toEqual({
        run: 'pilotcli git delete-branch "$KEEP" --kept-in "$HOME_WT" --pushed-to "$BRANCH"',
        env: {
          BRANCH: '{worktree.branch}',
          HOME_WT: '{worktree.path}',
          KEEP: 'pilot/ui-qa-{run.id}'
        },
        exitCodes: { ok: [0], skip: [3], stop: [] },
        timeoutMs: 2 * MINUTE,
        holdHome: false
      })
      expect(shellOf('close_page')).toEqual({
        run: 'orca tab close --page "$PAGE" --json || echo "page not closed"',
        env: { PAGE: '{steps.test.page}' },
        exitCodes: { ok: [0], skip: [], stop: [] },
        timeoutMs: MINUTE,
        holdHome: false
      })
    })

    // A shell step gets no item on stdin (only a check does), and `run:` takes no placeholders, so every value comes
    // through env.
    it('passes values to shell steps only through env', () => {
      for (const s of load().steps.filter((x) => x.agent === 'shell')) {
        expect([s.name, runPlaceholders(s.run ?? '')]).toEqual([s.name, []])
      }
    })

    // `always` steps still run after a stop, so the session and the report guard on the context's outcome.
    it('runs the session and the report whenever the context is ok, and neither after a context stop (exit 3)', () => {
      const context = { 'steps.context.outcome': 'ok' }
      for (const test of [ok('test'), broke('test'), late('test')]) {
        expect(runs('report', [ok('context'), test, ok('close_page')], context)).toBe(true)
      }
      expect(runs('test', [ok('context')], context)).toBe(true)
      const stopped = exited('context', 3, 'skip')
      expect(stopped.status).toBe('stopped')
      const skip = { 'steps.context.outcome': 'skip' }
      for (const name of [
        'test',
        'report',
        'flag',
        'flag_failed',
        'verdict',
        'fix',
        'merge_back',
        'forget_branch'
      ]) {
        expect([name, runs(name, [stopped], skip)]).toEqual([name, false])
      }
    })

    // flag shows the report's flag text; flag_failed only a context or report that broke, so a worktree is flagged once.
    // A flag that fails never fails the run.
    it('flags the worktree once: with the report’s text, else as a failed night', () => {
      expect(step('flag')).toMatchObject({
        when: '{steps.report.flag} != null',
        env: { WT: '{worktree.path}', TEXT: '{steps.report.flag}', UNREAD: '{steps.report.unread}' }
      })
      expect(step('flag_failed')).toMatchObject({
        when: "{steps.context.outcome} != 'skip' and {steps.report.flag} == null",
        env: { WT: '{worktree.path}', RUN: '{run.id}' }
      })
      for (const name of ['flag', 'flag_failed', 'flag_held']) {
        expect(step(name).run).toContain('orca worktree set --worktree "path:$WT"')
        expect(step(name).run).toContain('|| echo "worktree flag not set"')
      }
      expect(step('flag_failed').run).toContain('--unread')
      const flagged = 'ui-qa: 2 bugs → Agent Work/Automations/ui-qa-overnight/feat-x.md'
      // [why, how the steps before ended, the context's outcome, the report's flag, flag runs, flag_failed runs]
      const cases: [string, EndedStep[], string, string | null, boolean, boolean][] = [
        ['the report gave its flag', [ok('context'), ok('report')], 'ok', flagged, true, false],
        // create-report fails when a card or a write failed, and still gives the render_failed flag.
        [
          'the report failed to render',
          [ok('context'), broke('report')],
          'ok',
          flagged,
          true,
          false
        ],
        ['the report crashed', [ok('context'), broke('report')], 'ok', null, false, true],
        ['the context failed', [exited('context', 1, 'failed')], 'failed', null, false, true],
        [
          'the context had nothing to test',
          [exited('context', 3, 'skip')],
          'skip',
          null,
          false,
          false
        ]
      ]
      for (const [why, ended, context, text, flag, failed] of cases) {
        const at = { 'steps.context.outcome': context, 'steps.report.flag': text }
        expect([why, runs('flag', ended, at), runs('flag_failed', ended, at)]).toEqual([
          why,
          flag,
          failed
        ])
      }
    })

    // A night that tested nothing fails, so retry_after_failure holds its head 12 hours; a report that gave no answer
    // fails it at start (its env can't be rendered).
    it('fails the verdict only when the night tested nothing', () => {
      const verdict = step('verdict')
      expect(shellOf('verdict')).toMatchObject({
        env: { TESTED: '{steps.report.tested}' },
        timeoutMs: MINUTE
      })
      expect(verdict.when).toBeNull()
      expect(runs('verdict', [ok('context'), broke('test'), broke('report')], {})).toBe(true)
      const exit = (tested: ItemFields): number | null => {
        const env = renderShellEnv(verdict.env, tested)
        if (!env.ok) {
          return null
        }
        return spawnSync('/bin/sh', ['-c', verdict.run ?? ''], {
          env: { PATH: process.env.PATH, ...env.env }
        }).status
      }
      expect(exit({ 'steps.report.tested': true })).toBe(0)
      expect(exit({ 'steps.report.tested': false })).toBe(1)
      expect(exit({})).toBeNull()
    })

    // fix == true implies tested, so the verdict never skips the fixer's steps; fix is `always`, so merge back runs after
    // a fixer that failed or timed out, and forget_branch after a merge back that broke.
    it('fixes only what the report handed over, then merges it back and forgets the keep branch', () => {
      const before = [
        ok('context'),
        ok('test'),
        ok('close_page'),
        ok('report'),
        ok('flag'),
        ok('verdict')
      ]
      const fix = { 'steps.report.fix': true }
      expect(runs('fix', before, fix)).toBe(true)
      expect(runs('fix', before, { 'steps.report.fix': false })).toBe(false)
      expect(runs('fix', before, {})).toBe(false)
      for (const fixer of [ok('fix'), broke('fix'), late('fix')]) {
        expect(runs('merge_back', [...before, fixer], fix)).toBe(true)
        expect(runs('forget_branch', [...before, fixer, broke('merge_back')], fix)).toBe(true)
      }
      for (const name of ['merge_back', 'forget_branch']) {
        expect([
          name,
          runs(name, [...before, unrun('fix')], { 'steps.report.fix': false })
        ]).toEqual([name, false])
      }
    })

    // A merge back that skips (home busy, dirty, or diverged) leaves the fixes on the keep branch, and says so.
    it('flags the keep branch only when the merge back skipped', () => {
      expect(step('flag_held')).toMatchObject({
        when: "{steps.merge_back.outcome} == 'skip'",
        env: {
          WT: '{worktree.path}',
          KEEP: 'pilot/ui-qa-{run.id}',
          WHY: '{steps.merge_back.reason}'
        }
      })
      const before = [ok('context'), ok('report'), ok('verdict'), ok('fix')]
      const skipped = exited('merge_back', 3, 'skip')
      expect(skipped.status).toBe('skipped')
      const cases: [string, EndedStep, string | null, boolean][] = [
        ['skipped', skipped, 'skip', true],
        ['merged', exited('merge_back', 0, 'ok'), 'ok', false],
        ['failed', exited('merge_back', 1, 'failed'), 'failed', false],
        ['not run', unrun('merge_back'), null, false]
      ]
      for (const [why, merge, outcome, held] of cases) {
        const fields = { 'steps.merge_back.outcome': outcome, 'steps.merge_back.reason': 'busy' }
        expect([why, runs('flag_held', [...before, merge], fields)]).toEqual([why, held])
      }
    })

    it('lets the night finish while the independent preparation job prepares its code cards', () => {
      const preparation = loadPortedAutomation('prepare-inbox-item-context').definition
      expect(load().steps.some((s) => s.skill === 'item-details')).toBe(false)
      expect(preparation.items).toMatchObject({ kind: 'inbox_preparation' })
      expect(preparation.workspace).toEqual({ kind: 'item_worktree' })
      expect(preparation.steps).toHaveLength(1)
      expect(preparation.steps[0]).toMatchObject({
        skill: 'prepare-inbox-item-context',
        mode: 'worker',
        always: false
      })
      expect(preparation.powers).toEqual([])
    })

    // Spec §7.10.14 (2): an answer works in my worktree when it's free, else in a throwaway, never with a stack.
    it("sends my answers to the asking session, else the skill's answers mode, never with a stack", () => {
      expect(load().answers).toEqual({
        resume: 'asking_session',
        stack: 'never',
        else: { agent: 'claude', skill: 'ui-qa', mode: 'answers' }
      })
      expect(answerEnvOf(load(), '/wt/web-1', null)).toEqual({
        kind: 'env',
        subject: { kind: 'worktree', worktree: '/wt/web-1', at: null },
        writes: true,
        stack: 'never'
      })
      expect(readFileSync(join(SKILL, 'SKILL.md'), 'utf8')).toContain(
        '~/.agents/skills/ui-qa/modes/answers.md'
      )
      const answers = readFileSync(join(SKILL, 'modes', 'answers.md'), 'utf8')
      expect(answers).toContain('a throwaway copy of it with a detached HEAD and no stack')
      expect(answers).toContain('`git branch -f pilot/ui-qa-<that id> HEAD`')
      expect(answers).toContain('pilot action run --name=push')
      expect(answers).toContain('never `git push`')
    })

    // `page` names the browser page create-page made, so close_page closes it after the turn.
    it('has the modes name the outputs the steps read', () => {
      expect(modeOutputs('run')).toEqual(['outcome', 'page'])
      expect(modeOutputs('fix')).toEqual([])
      expect(modeOutputs('answers')).toEqual(['outcome', 'item_status', 'reply'])
    })

    // In a Pilot run the report files each finding as a card in Pilot's inbox (Pilot never reads the note's items),
    // so the fixer closes the cards it fixed and files new questions there, never as `- [ ]` lines. It works in the
    // throwaway and keeps its commits on the branch forget_branch deletes once they're home.
    it("has the fixer work in the throwaway, keep its commits on the keep branch, and close its cards in Pilot's inbox", () => {
      const fix = readFileSync(join(SKILL, 'modes', 'fix.md'), 'utf8')
      expect(fix).toContain("the job's merge_back step brings your commits into it")
      expect(fix).toContain('`git branch -f pilot/ui-qa-$PILOT_RUN_ID HEAD`')
      expect(fix).toContain("the report's findings are cards in Pilot's inbox")
      expect(fix).toContain("pilot inbox tick --id <the handoff's cards[<finding id>]>")
      // Posted with pilotcli inbox create-card as plain cards (D1): no --evidence, and never through the intake.
      expect(fix).toContain('pilotcli inbox create-card --kind <default|flagged|question>')
      expect(fix).toContain('as a plain card')
      expect(fix).toContain("--worktree '<my worktree>'")
      expect(fix).not.toContain('--evidence')
      expect(fix).not.toContain('context.py enqueue')
      expect(fix).toContain('write no `- [ ]` line')
      expect(fix).toContain('Commit locally, never push.')
      expect(fix).toContain('pilotcli skills create-report ui-qa --fix-outcomes')
    })

    it('loads through the loader on a copy', () => {
      const copy = mkdtempSync(join(tmpdir(), 'parity-04-yaml-'))
      for (const file of ['ui-qa-overnight.yaml', 'people.yaml']) {
        cpSync(join(portedAutomationsDir(), file), join(copy, file))
      }
      const loaded = loadDefinitions([copy])
      expect(loaded.errors).toEqual([])
      expect(loaded.definitions.map((d) => d.id)).toEqual(['ui-qa-overnight'])
      expect(existsSync(YAML)).toBe(true)
    })
  }
)
