#!/usr/bin/env node
// Switches every automation the mover moved between Pilot and Orca, without one ever running in both.
//
//   node src/packages/pilot/scripts/switch-automations.mjs --to orca|pilot [--apply]
//
// It reads Pilot's move record and touches only the automations that were enabled in Orca when they
// moved; the ones you start by hand stay disabled in both. For each one it disables the app it
// leaves, reads that back, and only then enables the app it goes to. Without --apply it is a dry run.

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { callJson, readOrcaState } from './move-orca-automation-apply.mjs'
import { DEFAULT_PILOT_BIN } from './move-orca-automation.mjs'
import { DEFAULT_RECORD_FILE, readRecords } from './move-orca-automation-record.mjs'
import { run } from './run.mjs'

const HELP = `Usage: node src/packages/pilot/scripts/switch-automations.mjs --to orca|pilot [options]

Moves every automation the mover moved to one app: disabled in the other first, verified, then enabled.
Only automations that were enabled in Orca when they moved are touched. Without --apply it prints the plan.

  --to <app>             orca or pilot (required)
  --apply                make the changes
  --record-file <path>   Pilot's record of moves (default: ~/Library/Application Support/Pilot/moved-automations.json)
  --orca-bin <path>      real Orca's CLI (default: /Applications/Orca.app/Contents/Resources/bin/orca)
  --pilot-bin <path>     Pilot's CLI (default: the one inside dist/mac-arm64/Pilot.app)`

export const DEFAULT_ORCA_BIN = '/Applications/Orca.app/Contents/Resources/bin/orca'
export const ORCA_DATA = join(homedir(), 'Library', 'Application Support', 'orca')
const LABEL = { orca: 'Orca', pilot: 'Pilot' }

const editArgs = (id, enabled) => [
  'automations',
  'edit',
  '--id',
  id,
  enabled ? '--enabled' : '--disabled'
]

// The automations to switch: { name, ids: { orca, pilot } } for each move that left a job enabled.
export function switchable(records) {
  return Object.entries(records)
    .filter(([, entry]) => entry.orcaWasEnabled === true && entry.pilotId)
    .map(([orcaId, entry]) => ({ name: entry.name, ids: { orca: orcaId, pilot: entry.pilotId } }))
}

function runtimeId(runner, label) {
  return callJson(runner, `${label} status`, ['status', '--json'])?.runtime?.runtimeId
}

// Each CLI has to reach its own running app. `orca` in a Pilot terminal is Pilot's, so without
// this check a switch could edit Pilot twice and think it had edited Orca.
export function checkApps(clis) {
  const orcaId = runtimeId(clis.orca, 'orca')
  const pilotId = runtimeId(clis.pilot, 'pilot')
  if (!orcaId || !pilotId) {
    throw new Error('both Orca and Pilot have to be running')
  }
  if (orcaId === pilotId) {
    throw new Error(
      `the Orca and Pilot CLIs both reach runtime ${orcaId}; pass --orca-bin with real Orca's CLI`
    )
  }
}

// Sets one side and reads it back: true when the read-back shows the wanted state.
function setAndVerify(runner, id, enabled, readOptions) {
  const result = runner(editArgs(id, enabled))
  if (result.code !== 0) {
    return false
  }
  return readOrcaState(runner, id, readOptions) === (enabled ? 'enabled' : 'disabled')
}

// One automation: 'already', 'would', 'switched' or 'failed', and a line saying what happened.
export function switchOne(job, to, clis, { apply, readOptions }) {
  const from = to === 'orca' ? 'pilot' : 'orca'
  const fromState = readOrcaState(clis[from], job.ids[from], readOptions)
  const toState = readOrcaState(clis[to], job.ids[to], readOptions)
  if (fromState === 'unknown' || toState === 'unknown') {
    return {
      status: 'failed',
      line: `${job.name}: couldn't read it in ${fromState === 'unknown' ? LABEL[from] : LABEL[to]}; changed nothing`
    }
  }
  if (fromState === 'disabled' && toState === 'enabled') {
    return { status: 'already', line: `${job.name}: already runs in ${LABEL[to]} only` }
  }
  if (!apply) {
    return {
      status: 'would',
      line: `${job.name}: would disable in ${LABEL[from]}, then enable in ${LABEL[to]}`
    }
  }
  if (fromState === 'enabled' && !setAndVerify(clis[from], job.ids[from], false, readOptions)) {
    return {
      status: 'failed',
      line: `${job.name}: disabling in ${LABEL[from]} didn't take; left ${LABEL[to]} alone, so it still runs in ${LABEL[from]}`
    }
  }
  if (toState !== 'enabled' && !setAndVerify(clis[to], job.ids[to], true, readOptions)) {
    return {
      status: 'failed',
      line: `${job.name}: disabled in ${LABEL[from]} but enabling in ${LABEL[to]} didn't take; it runs in NEITHER. Rerun this command to finish`
    }
  }
  return {
    status: 'switched',
    line: `${job.name}: disabled in ${LABEL[from]}, enabled in ${LABEL[to]} (verified)`
  }
}

// Moved automations are Orca-style jobs. A Pilot whose own Orca engine is off (the default since the
// orca-automations-off hook) never runs them, so switching them there would leave them running nowhere.
export function checkPilotRunsOrcaAutomations(pilot) {
  const status = callJson(pilot, 'pilot automations status', ['automations', 'status', '--json'])
  if (status?.orcaAutomationsOff !== false) {
    throw new Error(
      "Pilot's own Orca engine is off, so moved automations switched to Pilot would run nowhere. Use the YAML automations, or start Pilot with PILOT_ORCA_AUTOMATIONS=on."
    )
  }
}

export function switchAutomations({ to, apply, records, clis, log, readOptions }) {
  const jobs = switchable(records)
  if (jobs.length === 0) {
    log('No moved automations to switch.')
    return 0
  }
  checkApps(clis)
  if (to === 'pilot') {
    checkPilotRunsOrcaAutomations(clis.pilot)
  }
  log(`${apply ? 'Switching' : 'Dry run: switching'} ${jobs.length} automation(s) to ${LABEL[to]}.`)
  const results = jobs.map((job) => switchOne(job, to, clis, { apply, readOptions }))
  for (const result of results) {
    log(`  ${result.line}`)
  }
  const failed = results.filter((result) => result.status === 'failed').length
  if (failed > 0) {
    log(`${failed} automation(s) didn't switch; see above.`)
    return 1
  }
  if (!apply) {
    log('Nothing changed. Add --apply to do it.')
  }
  return 0
}

export function parseArgs(argv) {
  const options = {
    apply: false,
    help: false,
    recordFile: DEFAULT_RECORD_FILE,
    orcaBin: DEFAULT_ORCA_BIN,
    pilotBin: DEFAULT_PILOT_BIN
  }
  const valueFlags = {
    '--to': 'to',
    '--record-file': 'recordFile',
    '--orca-bin': 'orcaBin',
    '--pilot-bin': 'pilotBin'
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') {
      options.apply = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (Object.hasOwn(valueFlags, arg) && argv[index + 1] !== undefined) {
      options[valueFlags[arg]] = argv[index + 1]
      index += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }
  if (!options.help && !Object.hasOwn(LABEL, options.to ?? '')) {
    throw new Error('--to orca or --to pilot is required')
  }
  return options
}

// Real Orca's CLI finds its app through ORCA_USER_DATA_PATH, which a Pilot terminal sets to Pilot's.
const runnerFor = (bin, env) => (args) => {
  const result = run(bin, args, { timeoutMs: 60_000, env })
  return { code: result.code ?? 1, stdout: result.stdout, stderr: result.stderr }
}

export function runCli(argv, log = console.log, logError = console.error, runners = {}) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    logError(error.message)
    logError(HELP)
    return 2
  }
  if (options.help) {
    log(HELP)
    return 0
  }
  try {
    return switchAutomations({
      to: options.to,
      apply: options.apply,
      records: readRecords(options.recordFile),
      clis: {
        orca:
          runners.orca ??
          runnerFor(options.orcaBin, { ...process.env, ORCA_USER_DATA_PATH: ORCA_DATA }),
        pilot: runners.pilot ?? runnerFor(options.pilotBin, process.env)
      },
      log
    })
  } catch (error) {
    logError(`Stopped before changing anything: ${error.message}`)
    return 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  process.exit(runCli(process.argv.slice(2)))
}
