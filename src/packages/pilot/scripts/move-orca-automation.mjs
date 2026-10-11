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
  unmappableFields
} from './move-orca-automation-map.mjs'
import { applyFresh, callJson, readOrca, resumeCopy } from './move-orca-automation-apply.mjs'
import { DEFAULT_RECORD_FILE, readRecords } from './move-orca-automation-record.mjs'
import { run } from './run.mjs'

const HELP = `Usage: node src/packages/pilot/scripts/move-orca-automation.mjs --id <orca automation id> [options]

Copies one Orca automation into Pilot. Without --apply it is a dry run: it prints the plan and changes nothing.

  --id <id>              the Orca automation to move (required)
  --apply                create it in Pilot (disabled), verify it, then continue as below
  --disable-in-orca      after verifying, disable it in Orca and enable it in Pilot
                         (without it, Pilot's copy stays disabled and the two commands are printed)
  --allow-drop <field>   accept losing a field Pilot's create can't express (repeatable)
  --record-file <path>   Pilot's record of moves (default: ~/Library/Application Support/Pilot/moved-automations.json)
  --orca-bin <path>      Orca's CLI (default: orca)
  --pilot-bin <path>     Pilot's CLI (default: the one inside dist/mac-arm64/Pilot.app)`

export const DEFAULT_PILOT_BIN = join(
  resolve(import.meta.dirname, '../../../..'),
  'dist/mac-arm64/Pilot.app/Contents/Resources/bin/pilot'
)

// The Pilot copy of this Orca automation: by the move record's Pilot id first (survives renames),
// then by name and target.
function findCopy(source, copies, records) {
  const record = records[source.id]
  const recorded = record ? copies.find((candidate) => candidate.id === record.pilotId) : undefined
  if (recorded) {
    return { copy: recorded, via: 'record', record }
  }
  const named = copies.find(
    (candidate) => candidate.name === source.name && sameTarget(candidate, source)
  )
  return named ? { copy: named, via: 'name and target', record } : undefined
}

function sameTarget(a, b) {
  return a.workspaceMode === b.workspaceMode && targetPath(a) === targetPath(b)
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
  for (const planNote of mapping.notes) {
    log(`Note, ${planNote}`)
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
  recordFile = DEFAULT_RECORD_FILE,
  now = () => new Date(),
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

  const copies =
    callJson(pilot, 'pilot automations list', ['automations', 'list', '--json']).automations ?? []
  const found = findCopy(source, copies, readRecords(recordFile))
  if (found) {
    return resumeCopy(
      { source, options, orca, pilot, log, recordFile, now, apply },
      found.copy,
      found
    )
  }

  const mapping = mapAutomation(source)
  printPlan(source, mapping, dropped, options, log)
  if (!apply) {
    log('Dry run: nothing changed. Add --apply to do it.')
    return { status: 'dry-run', exitCode: 0, mapping }
  }
  return applyFresh({ source, mapping, options, orca, pilot, log, recordFile, now })
}

export function parseArgs(argv) {
  const options = {
    id: undefined,
    apply: false,
    disableInOrca: false,
    help: false,
    allowDrop: [],
    orcaBin: 'orca',
    pilotBin: DEFAULT_PILOT_BIN,
    recordFile: DEFAULT_RECORD_FILE
  }
  const valueFlags = {
    '--id': 'id',
    '--record-file': 'recordFile',
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
