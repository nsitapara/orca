// The write steps of move-orca-automation.mjs: create the Pilot copy disabled, verify it, then
// switch over (Orca off, verified, before Pilot on). One `switchover` serves a fresh copy and a
// retry, so a half-done move resumes from wherever it stopped.
import { formatCommand, verifyCopy } from './move-orca-automation-map.mjs'
import { removeRecord, writeRecord } from './move-orca-automation-record.mjs'

export const ORCA_READ_ATTEMPTS = 3

// Runs a CLI and parses its --json envelope. Throws a message naming the command on any failure.
export function callJson(runner, label, args) {
  const result = runner(args)
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`${label} failed (exit ${result.code}): ${detail}`)
  }
  let body
  try {
    body = JSON.parse(result.stdout)
  } catch {
    throw new Error(`${label} printed output that isn't JSON`)
  }
  if (body.ok === false) {
    throw new Error(`${label} failed: ${JSON.stringify(body.error)}`)
  }
  return body.result
}

export function readOrca(orca, id) {
  const result = orca(['automations', 'show', '--id', id, '--json'])
  const text = `${result.stderr}${result.stdout}`
  if (result.code !== 0) {
    const notFound = /not.?found|no automation/i.test(text)
    const message = notFound ? 'not found in Orca' : `orca automations show failed: ${text.trim()}`
    return { error: `Orca automation ${id}: ${message}` }
  }
  try {
    const body = JSON.parse(result.stdout)
    if (body.ok === false || !body.result?.automation) {
      return { error: `Orca automation ${id} not found in Orca` }
    }
    return { automation: body.result.automation }
  } catch {
    return { error: `orca automations show printed output that isn't JSON` }
  }
}

// Orca's enabled state by read-back, retried: 'enabled', 'disabled', or 'unknown' when every read failed.
export function readOrcaState(orca, id) {
  for (let attempt = 0; attempt < ORCA_READ_ATTEMPTS; attempt += 1) {
    const read = readOrca(orca, id)
    if (!read.error) {
      return read.automation.enabled === false ? 'disabled' : 'enabled'
    }
  }
  return 'unknown'
}

const pilotShow = (id) => ['automations', 'show', '--id', id, '--json']
const pilotEnable = (id) => ['automations', 'edit', '--id', id, '--enabled']
const orcaDisable = (id) => ['automations', 'edit', '--id', id, '--disabled']
const orcaEnable = (id) => ['automations', 'edit', '--id', id, '--enabled']

const ORCA_WORDS = {
  enabled: 'enabled (verified by read-back)',
  disabled: 'disabled (verified by read-back)',
  unknown: 'UNKNOWN (the read-back failed)'
}

export function printState(state, log) {
  log('State now:')
  const pilotLine = state.pilotId
    ? `automation ${state.pilotId} exists, ${state.pilotEnabled ? 'ENABLED' : 'disabled'}`
    : 'nothing created by this run'
  log(`  Pilot: ${pilotLine}`)
  log(`  Orca: ${ORCA_WORDS[state.orca]}${state.orcaChangedByRun ? ', disabled by this run' : ''}`)
}

// Records progress in Pilot's own file; a write problem is reported, never fatal.
function note(ctx, stateName) {
  const { source, recordFile, now, log, state } = ctx
  try {
    writeRecord(recordFile, source.id, {
      pilotId: state.pilotId,
      name: source.name,
      movedAt: now().toISOString(),
      orcaWasEnabled: ctx.orcaWasEnabled,
      state: stateName
    })
  } catch (error) {
    log(`Warning: couldn't update the move record: ${error.message}`)
  }
}

function removeFromPilot(ctx) {
  const { pilot, log, state, recordFile, source } = ctx
  const result = pilot(['automations', 'remove', '--id', state.pilotId, '--json'])
  if (result.code === 0) {
    log(`Undone: removed the Pilot automation ${state.pilotId} this run created.`)
    state.pilotId = null
    try {
      removeRecord(recordFile, source.id)
    } catch (error) {
      log(`Warning: couldn't clear the move record: ${error.message}`)
    }
    return
  }
  log(
    `Could not remove Pilot automation ${state.pilotId} (still there, disabled): ${(result.stderr || result.stdout).trim()}`
  )
  log(
    `Remove it by hand if wanted: ${formatCommand(ctx.options.pilotBin, ['automations', 'remove', '--id', state.pilotId])}; a rerun would otherwise pick it up and resume.`
  )
}

function fail(ctx, message, { undo }) {
  const { state, log } = ctx
  log(`FAILED: ${message}`)
  // Remove only a copy this run created, still disabled, while Orca is verified untouched.
  if (undo && ctx.created && state.pilotId && !state.pilotEnabled && state.orca === 'enabled') {
    removeFromPilot(ctx)
  }
  printState(state, log)
  return { status: 'failed', exitCode: 1, state }
}

function orcaUnknown(ctx) {
  const { state, log, source, options } = ctx
  const { orcaBin, pilotBin } = options
  log('FAILED: Orca state unknown. The disable was sent, but Orca could not be read back.')
  log(`Pilot's copy ${state.pilotId} is kept and stays disabled. Check Orca first:`)
  log(`  ${formatCommand(orcaBin, ['automations', 'show', '--id', source.id, '--json'])}`)
  log('If it shows disabled, finish with:')
  log(`  ${formatCommand(pilotBin, pilotEnable(state.pilotId))}`)
  log('If it still shows enabled, disable it, check again, then enable Pilot:')
  log(`  ${formatCommand(orcaBin, orcaDisable(source.id))}`)
  log('Or rerun this script with the same flags: it resumes from the state it finds.')
  note(ctx, 'orca-state-unknown')
  printState(state, log)
  return { status: 'failed', exitCode: 1, state }
}

// Disable Orca's copy and confirm it by read-back. Returns 'ok', 'enabled' or 'unknown'.
function disableInOrca(ctx) {
  const { orca, source, state, log } = ctx
  const edit = orca([...orcaDisable(source.id), '--json'])
  const seen = readOrcaState(orca, source.id)
  state.orca = seen
  if (seen === 'disabled') {
    state.orcaChangedByRun = true
    const detail =
      edit.code === 0 ? '' : ' (the edit reported an error, but Orca shows it disabled)'
    log(`Disabled in Orca (verified)${detail}.`)
    return 'ok'
  }
  if (seen === 'enabled') {
    const why = edit.code === 0 ? 'the edit reported success but' : 'the edit failed and'
    log(`Orca: ${why} Orca still shows it enabled (verified).`)
    return 'enabled'
  }
  return 'unknown'
}

function enableInPilot(ctx) {
  const { pilot, state, log, options, source } = ctx
  try {
    // Never enable Pilot unless Orca was just verified disabled.
    if (state.orca !== 'disabled') {
      throw new Error("won't enable Pilot while Orca isn't verified disabled")
    }
    callJson(pilot, 'pilot automations edit', [...pilotEnable(state.pilotId), '--json'])
    const shown = callJson(pilot, 'pilot automations show', pilotShow(state.pilotId))
    if (shown.automation.enabled !== true) {
      throw new Error('Pilot still shows the automation as disabled after the edit')
    }
  } catch (error) {
    log(`FAILED: ${error.message}`)
    log(
      "Orca's copy is disabled and Pilot's is not enabled, so it runs nowhere. Pilot's copy is kept. Enable it with:"
    )
    log(`  ${formatCommand(options.pilotBin, pilotEnable(state.pilotId))}`)
    log(`or move it back with: ${formatCommand(options.orcaBin, orcaEnable(source.id))}`)
    note(ctx, 'orca-disabled')
    printState(state, log)
    return { status: 'failed', exitCode: 1, state }
  }
  state.pilotEnabled = true
  note(ctx, 'switched')
  log('Enabled in Pilot (verified). Done: it runs in Pilot only.')
  return null
}

function handCommands(ctx) {
  const { options, source, state, log } = ctx
  log("Left Orca's copy as it is. To finish the switch by hand, in this order:")
  log(`  ${formatCommand(options.orcaBin, orcaDisable(source.id))}`)
  log(`  ${formatCommand(options.pilotBin, pilotEnable(state.pilotId))}`)
}

// From wherever the switch stopped: Orca on -> off (verified) -> Pilot on. Never Pilot on first.
export function switchover(ctx) {
  const { options, state, log } = ctx
  if (!options.disableInOrca) {
    handCommands(ctx)
    return {
      status: ctx.created ? 'applied' : 'exists',
      exitCode: 0,
      pilotId: state.pilotId,
      state
    }
  }
  if (state.orca === 'enabled') {
    const outcome = disableInOrca(ctx)
    if (outcome === 'enabled') {
      return fail(ctx, 'Orca could not be disabled', { undo: true })
    }
    if (outcome === 'unknown') {
      return orcaUnknown(ctx)
    }
    note(ctx, 'orca-disabled')
  }
  if (state.pilotEnabled) {
    log('Already switched: Orca is disabled and Pilot is enabled. Nothing to do.')
    return {
      status: ctx.created ? 'applied' : 'exists',
      exitCode: 0,
      pilotId: state.pilotId,
      state
    }
  }
  if (ctx.orcaWasEnabled === false) {
    log("Orca's copy was disabled before the move; Pilot's copy stays disabled to match.")
    return {
      status: ctx.created ? 'applied' : 'exists',
      exitCode: 0,
      pilotId: state.pilotId,
      state
    }
  }
  const failed = enableInPilot(ctx)
  return (
    failed ?? {
      status: ctx.created ? 'applied' : 'resumed',
      exitCode: 0,
      pilotId: state.pilotId,
      state
    }
  )
}

// Create the copy disabled, verify it field by field, record it, then switch over.
export function applyFresh(base) {
  const { source, mapping, pilot, log } = base
  const state = {
    pilotId: null,
    pilotEnabled: false,
    orca: source.enabled ? 'enabled' : 'disabled',
    orcaChangedByRun: false
  }
  const ctx = { ...base, state, created: true, orcaWasEnabled: source.enabled }
  try {
    state.pilotId = callJson(pilot, 'pilot automations create', mapping.args).automation.id
    log(`Created in Pilot, disabled: ${state.pilotId}`)
  } catch (error) {
    return fail(ctx, error.message, { undo: false })
  }
  note(ctx, 'created-disabled')
  try {
    const shown = callJson(pilot, 'pilot automations show', pilotShow(state.pilotId))
    const problems = verifyCopy(source, shown.automation)
    if (problems.length > 0) {
      return fail(ctx, `the Pilot copy doesn't match Orca's:\n  - ${problems.join('\n  - ')}`, {
        undo: true
      })
    }
    log('Verified: every mapped field matches.')
  } catch (error) {
    return fail(ctx, error.message, { undo: true })
  }
  return switchover(ctx)
}

// A Pilot copy already exists: report both sides, and with --apply carry on from there.
export function resumeCopy(base, copy, found) {
  const { source, options, log } = base
  const state = {
    pilotId: copy.id,
    pilotEnabled: copy.enabled === true,
    orca: source.enabled ? 'enabled' : 'disabled',
    orcaChangedByRun: false
  }
  const orcaWasEnabled = found.record ? found.record.orcaWasEnabled !== false : true
  const ctx = { ...base, state, created: false, orcaWasEnabled }
  log(
    `Pilot already has a copy of "${source.name}" (${copy.id}, found by ${found.via}): Pilot ${state.pilotEnabled ? 'ENABLED' : 'disabled'}, Orca ${source.enabled ? 'ENABLED' : 'disabled'}.`
  )
  const ignore = found.via === 'record' ? ['name'] : []
  const problems = verifyCopy(source, copy, { checkEnabled: false, ignore })
  for (const problem of problems) {
    log(`  note, differs from Orca's (not blocking): ${problem}`)
  }
  if (state.pilotEnabled && source.enabled) {
    log('  WARNING: both are enabled, so it runs in both apps.')
  }
  if (!base.apply) {
    log(describeNext(ctx))
    log('Dry run: nothing changed. Add --apply --disable-in-orca to finish the switch.')
    return { status: 'exists', exitCode: 0, pilotId: copy.id, state }
  }
  if (!options.disableInOrca) {
    log(describeNext(ctx))
    log('Without --disable-in-orca nothing is changed on a retry.')
    return { status: 'exists', exitCode: 0, pilotId: copy.id, state }
  }
  return switchover(ctx)
}

function describeNext(ctx) {
  const { state, orcaWasEnabled } = ctx
  if (state.orca === 'enabled') {
    return 'Next with --apply --disable-in-orca: disable it in Orca and verify, then enable it in Pilot.'
  }
  if (state.pilotEnabled) {
    return 'Already switched: nothing to do.'
  }
  if (orcaWasEnabled === false) {
    return "Orca's copy was disabled before the move, so Pilot's stays disabled; nothing to do."
  }
  return 'Next with --apply --disable-in-orca: enable it in Pilot.'
}
