#!/usr/bin/env node
// Checks Pilot's drop-in rule (D24): every hook in HOOKS.md is still present, and no upstream file
// changed on this branch without being listed. Run by the update command and by the test.
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runProcessSync } from '@orca/process-host'

const PILOT_DIR = 'src/packages/pilot/'

// Pilot scripts spawn through @orca/process-host (Orca's process-host ratchet forbids direct
// child_process imports). Copy this helper into other Pilot scripts that need to run a command.
export function run(cmd, args, opts = {}) {
  return runProcessSync({
    program: cmd,
    args,
    cwd: opts.cwd,
    env: opts.env,
    timeoutMs: opts.timeoutMs
  })
}

export function parseHooksTable(markdown) {
  const rows = []
  let seenSeparator = false
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) {
      continue
    }
    if (/^\|\s*-/.test(trimmed)) {
      seenSeparator = true
      continue
    }
    if (!seenSeparator) {
      continue
    }
    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim())
    if (cells.length < 4) {
      continue
    }
    const [hook, file, match, why] = cells
    rows.push({ hook, file: file.replace(/`/g, ''), match: match.replace(/^`|`$/g, ''), why })
  }
  return rows
}

function changedUpstreamFiles(repoRoot, upstreamRef) {
  const probe = run('git', ['rev-parse', '--verify', '--quiet', upstreamRef], { cwd: repoRoot })
  if (probe.code !== 0) {
    return null
  }
  const diff = run('git', ['diff', '--name-only', `${upstreamRef}...HEAD`], { cwd: repoRoot })
  if (diff.code !== 0) {
    return null
  }
  return diff.stdout.split('\n').filter((f) => f && !f.startsWith(PILOT_DIR))
}

export function checkHooks({ repoRoot, upstreamRef }) {
  const problems = []
  const table = parseHooksTable(readFileSync(join(repoRoot, PILOT_DIR, 'HOOKS.md'), 'utf8'))
  for (const row of table) {
    const path = join(repoRoot, row.file)
    if (!existsSync(path)) {
      problems.push(`hook "${row.hook}": ${row.file} is missing`)
      continue
    }
    if (!readFileSync(path, 'utf8').includes(row.match)) {
      problems.push(`hook "${row.hook}": ${row.file} no longer contains "${row.match}"`)
    }
  }
  if (upstreamRef) {
    const listed = new Set(table.map((r) => r.file))
    for (const file of changedUpstreamFiles(repoRoot, upstreamRef) ?? []) {
      if (!listed.has(file)) {
        problems.push(`${file} differs from ${upstreamRef} but isn't a hook in HOOKS.md`)
      }
    }
  }
  return { ok: problems.length === 0, problems }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const repoRoot = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
  const result = checkHooks({ repoRoot, upstreamRef: process.argv[2] ?? 'upstream/main' })
  for (const p of result.problems) {
    console.error(`✗ ${p}`)
  }
  if (result.ok) {
    console.log('✓ all Pilot hooks present')
  }
  process.exit(result.ok ? 0 : 1)
}
