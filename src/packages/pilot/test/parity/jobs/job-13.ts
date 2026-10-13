import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyImport } from '../../../src/main/importer/sweep-state/apply'
import {
  devE2ePipelinesMapper,
  devE2eStartsMapper
} from '../../../src/main/importer/sweep-state/dev-e2e'
import type { ScriptRunner } from '../../../src/main/fields/script-runner'
import { runIdsCommand, type IdsRunner } from '../../../src/main/sources/ids-from'
import type { PilotStore } from '../../../src/main/store/store'
import type { VerdictTable } from '../compare'
import type { ParityFixture } from '../fixture'
import { fixtureStateReader } from '../fixture-reader'
import { withLinearTickets } from '../linear-fixture'
import type { OldDecision } from '../old-side'
import { failed, ok } from '../overrides'
import type { ParityJob } from '../parity-case'
import { loadPortedAutomation, portedAutomationsDir } from '../ported'

export const JOB_13 = {
  job: '13',
  sweep: 'dev-e2e-fix',
  loop: 'dev-e2e',
  pipelines: 'dev-e2e-fix',
  starts: 'dev-e2e-fix-start'
}

// 13's words (jobs/job_13.py) and the verdicts that agree with them. pipeline:<id>: green and seen (not due), act (started),
// QUOTA; linear:<ID>: start (started), QUOTA, FAIL (a start the sweep refused, "...; retried next run": a failed check),
// has_session (not due), closed. A ticket that is not this job's is never read (where.ids_from), on either side.
export const VERDICTS_13: VerdictTable = {
  map: {
    green: ['notdue'],
    seen: ['notdue'],
    act: ['started'],
    QUOTA: ['skipped'],
    start: ['started'],
    has_session: ['notdue']
  },
  rows: [{ word: 'FAIL', reason: /; retried next run$/, verdicts: ['skipped'] }],
  whenOldMissing: ['out_of_scope'],
  known: [
    {
      key: 'pipeline:19',
      word: 'act',
      verdict: 'skipped',
      why: 'Pilot checks Claude quota before every 13 run; the old sweep checked it only before opening a ticket, so it still commented while Claude was out'
    },
    {
      key: 'linear:WEB-3',
      word: 'closed',
      verdict: 'absent',
      why: 'Pilot lists only tickets in an open state (state_type), so a canceled one has no row; the sweep reported it as closed'
    }
  ]
}

// The sweep's state, as Pilot keeps it: the two mappers' plans applied to the case's state files (each handled pipeline is
// dev-e2e-fix's once_per key "<id>"; each ticket whose session started is dev-e2e-fix-start's "<ID>"), so the import and
// the decisions are tested together.
export function seed13(store: PilotStore, f: ParityFixture): void {
  const read = fixtureStateReader(f)
  applyImport(store, devE2ePipelinesMapper.plan(read), f.now)
  applyImport(store, devE2eStartsMapper.plan(read), f.now)
}

// The script check the start automation runs, answered from the case: `check-worktree` from the old adapter's verdict on
// the same inputs (jobs/job_13.py runs pilot_mode.check_worktree under the case's reads), so the check's refusal is
// compared with the old start()'s.
export function answerScripts(old: OldDecision[], _f: ParityFixture): ScriptRunner {
  const checks = new Map(
    old.filter((d) => d.decision === 'script_check').map((d) => [d.key, d.reason])
  )
  return async (req) => {
    const key = req.env.PILOT_ITEM_KEY
    if (req.command.includes('check-worktree')) {
      const reason = checks.get(key) ?? ''
      return reason === '' ? ok() : failed(reason)
    }
    throw new Error(`parity: no answer for the script ${req.command}`)
  }
}

// A python3 on PATH that runs the skill's own scripts with gate's state root in a temp folder holding <tickets> as
// dev-e2e/tickets.json, so nothing under the real checkout is read or written.
export function shimmedState(tickets: unknown): { root: string; state: string; bin: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'parity-13-')))
  const state = join(root, 'agent-loops')
  mkdirSync(join(state, JOB_13.loop), { recursive: true })
  writeFileSync(join(state, JOB_13.loop, 'tickets.json'), JSON.stringify(tickets))
  const bin = join(root, 'bin')
  mkdirSync(bin)
  const real = spawnSync('/bin/sh', ['-c', 'command -v python3'], {
    encoding: 'utf8'
  }).stdout.trim()
  writeFileSync(
    join(root, 'shim.py'),
    [
      'import os, runpy, sys',
      'from pathlib import Path',
      'script = sys.argv[1]',
      'sys.argv = sys.argv[1:]',
      'sys.path.insert(0, str(Path(script).resolve().parent))',
      'import sweep',
      "sweep.gate.STATE_ROOT = Path(os.environ['PARITY_STATE_ROOT'])",
      "runpy.run_path(script, run_name='__main__')"
    ].join('\n')
  )
  writeFileSync(join(bin, 'python3'), `#!/bin/sh\nexec "${real}" "${join(root, 'shim.py')}" "$@"\n`)
  chmodSync(join(bin, 'python3'), 0o755)
  return { root, state, bin }
}

// where.ids_from on the case: the YAML's own command through Pilot's real runner (argv, its env), with python3 the
// shim above over the case's tickets.json, so the ids are what pilot_mode.py list-fix-tickets prints for that state.
export function answerIds(f: ParityFixture): IdsRunner {
  return async (cmd) => {
    const { state, bin } = shimmedState(f.state[`${JOB_13.loop}/tickets.json`] ?? {})
    return runIdsCommand({
      ...cmd,
      env: {
        ...cmd.env,
        PATH: `${bin}:${cmd.env.PATH ?? ''}`,
        PARITY_STATE_ROOT: state,
        PYTHONDONTWRITEBYTECODE: '1'
      }
    })
  }
}

function yamlOf(id: string): string {
  return join(portedAutomationsDir(), `${id}.yaml`)
}

function parityJob(id: string, prefix: string, extra: Partial<ParityJob>): ParityJob {
  return {
    job: JOB_13.job,
    folder: JOB_13.sweep,
    files: [yamlOf(id), join(portedAutomationsDir(), 'people.yaml')],
    table: VERDICTS_13,
    ownsKey: (key) => key.startsWith(prefix),
    seed: seed13,
    load() {
      const { definition, people } = loadPortedAutomation(id)
      return { def: definition, people }
    },
    ...extra
  }
}

// One old sweep, two automations: each is compared with the old decisions about its own items.
export const PARITY_13_PIPELINES = parityJob(JOB_13.pipelines, 'pipeline:', {})
export const PARITY_13_STARTS = parityJob(JOB_13.starts, 'linear:', {
  runScriptFor: answerScripts,
  runIdsFor: answerIds,
  tickDeps: withLinearTickets
})
