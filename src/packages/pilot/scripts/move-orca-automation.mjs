#!/usr/bin/env node
// Moves ONE Orca automation into Pilot without it ever running in both apps at once.
//
//   node src/packages/pilot/scripts/move-orca-automation.mjs --id <orca automation id> [--apply] [--disable-in-orca]
//
// It reads the automation with `orca automations show` (read-only), maps every field onto
// `pilot automations create` flags, and prints the plan. With --apply it creates the copy in Pilot
// DISABLED, reads it back and verifies it, and only then (with --disable-in-orca) disables Orca's
// and enables Pilot's. It never deletes anything in Orca, and never writes into Orca's folders.

import { join, resolve } from 'node:path'
import {
  DERIVED_FIELDS,
  formatCommand,
  mapAutomation,
  targetPath,
  unmappableFields,
  verifyCopy
} from './move-orca-automation-map.mjs'
import { run } from './run.mjs'

const HELP = `Usage: node src/packages/pilot/scripts/move-orca-automation.mjs --id <orca automation id> [options]

Copies one Orca automation into Pilot. Without --apply it is a dry run: it prints the plan and changes nothing.

  --id <id>              the Orca automation to move (required)
  --apply                create it in Pilot (disabled), verify it, then continue as below
  --disable-in-orca      after verifying, disable it in Orca and enable it in Pilot
                         (without it, Pilot's copy stays disabled and the two commands are printed)
  --allow-drop <field>   accept losing a field Pilot's create can't express (repeatable)
  --orca-bin <path>      Orca's CLI (default: orca)
  --pilot-bin <path>     Pilot's CLI (default: the one inside dist/mac-arm64/Pilot.app)`

export const DEFAULT_PILOT_BIN = join(
  resolve(import.meta.dirname, '../../../..'),
  'dist/mac-arm64/Pilot.app/Contents/Resources/bin/pilot'
)

// Runs a CLI and parses its --json envelope. Throws a message naming the command on any failure.
function callJson(runner, label, args) {
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

function readOrca(orca, id) {
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

function sameTarget(a, b) {
  return a.workspaceMode === b.workspaceMode && targetPath(a) === targetPath(b)
}

function removeFromPilot(pilot, id, state, log) {
  const result = pilot(['automations', 'remove', '--id', id, '--json'])
  if (result.code === 0) {
    state.pilotId = null
    log(`Undone: removed the Pilot automation ${id} this run created.`)
    return
  }
  log(`Could not remove Pilot automation ${id}: ${(result.stderr || result.stdout).trim()}`)
}

function printState(state, log) {
  log('State now:')
  log(
    `  Pilot: ${state.pilotId ? `automation ${state.pilotId} exists, ${state.pilotEnabled ? 'ENABLED' : 'disabled'}` : 'nothing created by this run'}`
  )
  log(`  Orca: ${state.orcaDisabled ? 'disabled by this run' : 'unchanged by this run'}`)
}

function finishCommands(orcaBin, pilotBin, orcaId, pilotId) {
  return [
    formatCommand(orcaBin, ['automations', 'edit', '--id', orcaId, '--disabled']),
    formatCommand(pilotBin, ['automations', 'edit', '--id', pilotId, '--enabled'])
  ]
}

function applyPlan(ctx) {
  const { source, mapping, options, orca, pilot, log } = ctx
  const state = { pilotId: null, pilotEnabled: false, orcaDisabled: false }
  const fail = (message, undo) => {
    log(`FAILED: ${message}`)
    if (undo && state.pilotId && !state.pilotEnabled && !state.orcaDisabled) {
      removeFromPilot(pilot, state.pilotId, state, log)
    }
    printState(state, log)
    return { status: 'failed', exitCode: 1, state }
  }
  let copy
  try {
    copy = callJson(pilot, 'pilot automations create', mapping.args).automation
    state.pilotId = copy.id
    log(`Created in Pilot, disabled: ${copy.id}`)
  } catch (error) {
    return fail(error.message, false)
  }
  try {
    const shown = callJson(pilot, 'pilot automations show', [
      'automations',
      'show',
      '--id',
      state.pilotId,
      '--json'
    ])
    const problems = verifyCopy(source, shown.automation)
    if (problems.length > 0) {
      return fail(`the Pilot copy doesn't match Orca's:\n  - ${problems.join('\n  - ')}`, true)
    }
    log('Verified: every mapped field matches.')
  } catch (error) {
    return fail(error.message, true)
  }
  if (!options.disableInOrca) {
    const [first, second] = finishCommands(
      options.orcaBin,
      options.pilotBin,
      source.id,
      state.pilotId
    )
    log(
      "Left Pilot's copy disabled and Orca's untouched. To finish the switch by hand, in this order:"
    )
    log(`  ${first}`)
    log(`  ${second}`)
    return { status: 'applied', exitCode: 0, state }
  }
  if (source.enabled) {
    try {
      callJson(orca, 'orca automations edit', [
        'automations',
        'edit',
        '--id',
        source.id,
        '--disabled',
        '--json'
      ])
      const check = readOrca(orca, source.id)
      if (check.error || check.automation.enabled !== false) {
        throw new Error('Orca still shows the automation as enabled after the edit')
      }
      state.orcaDisabled = true
      log('Disabled in Orca (verified).')
    } catch (error) {
      return fail(error.message, true)
    }
  } else {
    log("Already disabled in Orca; Pilot's copy stays disabled to match.")
    return { status: 'applied', exitCode: 0, state }
  }
  try {
    callJson(pilot, 'pilot automations edit', [
      'automations',
      'edit',
      '--id',
      state.pilotId,
      '--enabled',
      '--json'
    ])
    const shown = callJson(pilot, 'pilot automations show', [
      'automations',
      'show',
      '--id',
      state.pilotId,
      '--json'
    ])
    if (shown.automation.enabled !== true) {
      throw new Error('Pilot still shows the automation as disabled after the edit')
    }
    state.pilotEnabled = true
    log('Enabled in Pilot (verified). Done: it runs in Pilot only.')
    return { status: 'applied', exitCode: 0, state }
  } catch (error) {
    log(`FAILED: ${error.message}`)
    log(
      `Orca's copy is disabled and Pilot's is not enabled, so it runs nowhere. Not removing Pilot's copy. Enable it with:`
    )
    log(
      `  ${formatCommand(options.pilotBin, ['automations', 'edit', '--id', state.pilotId, '--enabled'])}`
    )
    log(
      `or move it back with: ${formatCommand(options.orcaBin, ['automations', 'edit', '--id', source.id, '--enabled'])}`
    )
    printState(state, log)
    return { status: 'failed', exitCode: 1, state }
  }
}

function printPlan(source, mapping, dropped, options, log) {
  log(
    `Orca automation: ${source.name} (${source.id}), ${source.enabled ? 'enabled' : 'disabled'} in Orca`
  )
  log(`  prompt: ${source.prompt}`)
  log(
    `  trigger: ${source.rrule} (${source.timezone}), agent ${source.agentId}, mode ${source.workspaceMode}, target ${targetPath(source)}`
  )
  log('Would run:')
  log(`  ${formatCommand(options.pilotBin, mapping.args)}`)
  log('Fields mapped:')
  for (const [field, flag] of mapping.mapped) {
    log(`  ${field} -> ${flag}`)
  }
  log(`Fields Pilot sets itself (not copied): ${DERIVED_FIELDS.join(', ')}`)
  const droppedNames = Object.keys(dropped)
  log(
    droppedNames.length === 0
      ? 'Fields dropped: none'
      : `Fields dropped (allowed): ${droppedNames.join(', ')}`
  )
  for (const [field, reason] of Object.entries(dropped)) {
    log(`  ${field}: ${reason}`)
  }
  if (options.disableInOrca) {
    const orcaStep = source.enabled
      ? 'disable it in Orca, then enable it in Pilot'
      : 'leave both disabled (Orca already has it disabled)'
    log(`With --apply: create disabled, verify, then ${orcaStep}.`)
  } else {
    log(
      "With --apply: create disabled and verify; Orca is NOT touched and Pilot's copy stays disabled."
    )
  }
}

// Core, with both CLIs injected as (args) => { code, stdout, stderr }.
export function moveAutomation({
  id,
  apply,
  disableInOrca,
  allowDrop = [],
  orca,
  pilot,
  orcaBin = 'orca',
  pilotBin = DEFAULT_PILOT_BIN,
  log = console.log
}) {
  const options = { apply, disableInOrca, orcaBin, pilotBin }
  const read = readOrca(orca, id)
  if (read.error) {
    log(read.error)
    return { status: 'not-found', exitCode: 1 }
  }
  const source = read.automation
  const blocked = unmappableFields(source)
  const refusedFields = Object.keys(blocked).filter((field) => !allowDrop.includes(field))
  const dropped = Object.fromEntries(
    Object.entries(blocked).filter(([field]) => allowDrop.includes(field))
  )
  const refusals = refusedFields.map(
    (field) =>
      `field "${field}" can't be moved: ${blocked[field]}. Pass --allow-drop ${field} to move without it.`
  )

  const target = targetPath(source)
  if (!target || !source.runContext) {
    refusals.push('the automation has no repo or worktree target to recreate')
  } else {
    const repos = callJson(pilot, 'pilot repo list', ['repo', 'list', '--json']).repos ?? []
    const repoPath = source.runContext.path
    if (!repos.some((repo) => repo.path === repoPath)) {
      const named = repos.some((repo) => repo.displayName === repoPath.split('/').pop())
      const hint = named ? ' (a repo with that name exists at a different path)' : ''
      refusals.push(`the target repo ${repoPath} isn't in Pilot${hint}; add it to Pilot first`)
    } else if (source.workspaceMode === 'existing') {
      const trees =
        callJson(pilot, 'pilot worktree list', ['worktree', 'list', '--json']).worktrees ?? []
      if (!trees.some((tree) => tree.path === target)) {
        refusals.push(`the worktree ${target} isn't known to Pilot`)
      }
    }
  }
  if (refusals.length > 0) {
    log(`Refusing to move "${source.name}" (${id}); nothing changed:`)
    for (const reason of refusals) {
      log(`  - ${reason}`)
    }
    return { status: 'refused', exitCode: 1, refusals }
  }

  const existing = (
    callJson(pilot, 'pilot automations list', ['automations', 'list', '--json']).automations ?? []
  ).find((candidate) => candidate.name === source.name && sameTarget(candidate, source))
  if (existing) {
    log(
      `Pilot already has "${source.name}" on the same target (${existing.id}, ${existing.enabled ? 'enabled' : 'disabled'}). Nothing to do.`
    )
    return { status: 'exists', exitCode: 0, pilotId: existing.id }
  }

  const mapping = mapAutomation(source)
  printPlan(source, mapping, dropped, options, log)
  if (!apply) {
    log('Dry run: nothing changed. Add --apply to do it.')
    return { status: 'dry-run', exitCode: 0, mapping }
  }
  return applyPlan({ source, mapping, options, orca, pilot, log })
}

export function parseArgs(argv) {
  const options = {
    id: undefined,
    apply: false,
    disableInOrca: false,
    help: false,
    allowDrop: [],
    orcaBin: 'orca',
    pilotBin: DEFAULT_PILOT_BIN
  }
  const valueFlags = {
    '--id': 'id',
    '--orca-bin': 'orcaBin',
    '--pilot-bin': 'pilotBin'
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') {
      options.apply = true
    } else if (arg === '--disable-in-orca') {
      options.disableInOrca = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--allow-drop' && argv[index + 1] !== undefined) {
      options.allowDrop.push(...argv[index + 1].split(',').filter(Boolean))
      index += 1
    } else if (Object.hasOwn(valueFlags, arg) && argv[index + 1] !== undefined) {
      options[valueFlags[arg]] = argv[index + 1]
      index += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }
  if (!options.help && !options.id) {
    throw new Error('--id <orca automation id> is required')
  }
  return options
}

const runnerFor = (bin) => (args) => {
  const result = run(bin, args, { timeoutMs: 60_000 })
  return {
    code: result.code ?? 1,
    stdout: result.stdout,
    stderr: result.stderr
  }
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
    const outcome = moveAutomation({
      ...options,
      orca: runners.orca ?? runnerFor(options.orcaBin),
      pilot: runners.pilot ?? runnerFor(options.pilotBin),
      log
    })
    return outcome.exitCode
  } catch (error) {
    logError(`Stopped, nothing was changed by this step: ${error.message}`)
    return 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  process.exit(runCli(process.argv.slice(2)))
}
