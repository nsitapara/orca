import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error -- .mjs script without type declarations
import { checkHooks, parseHooksTable } from './hook-guard.mjs'

function fixtureRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'pilot-hooks-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

const TABLE = [
  '| Hook | File | Match | Why |',
  '|---|---|---|---|',
  '| main | src/main/a.ts | attachPilotMain( | starts Pilot |',
  '| tsconfig-node | config/tsconfig.node.json | ../src/packages/pilot/src/main/**/* | typecheck Pilot main |'
].join('\n')

describe('parseHooksTable', () => {
  it('reads every row after the separator', () => {
    expect(parseHooksTable(TABLE)).toEqual([
      { hook: 'main', file: 'src/main/a.ts', match: 'attachPilotMain(', why: 'starts Pilot' },
      {
        hook: 'tsconfig-node',
        file: 'config/tsconfig.node.json',
        match: '../src/packages/pilot/src/main/**/*',
        why: 'typecheck Pilot main'
      }
    ])
  })
})

describe('checkHooks', () => {
  it('passes when every listed file contains its match', () => {
    const root = fixtureRepo({
      'src/packages/pilot/HOOKS.md': TABLE,
      'src/main/a.ts': 'attachPilotMain(runtime) // pilot-hook: main\n',
      'config/tsconfig.node.json': '{"include": ["../src/packages/pilot/src/main/**/*"]}'
    })
    expect(checkHooks({ repoRoot: root })).toEqual({ ok: true, problems: [] })
  })

  it('names the hook and file when a match is missing after a merge', () => {
    const root = fixtureRepo({
      'src/packages/pilot/HOOKS.md': TABLE,
      'src/main/a.ts': 'nothing here\n',
      'config/tsconfig.node.json': '{"include": ["../src/packages/pilot/src/main/**/*"]}'
    })
    const result = checkHooks({ repoRoot: root })
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      'hook "main": src/main/a.ts no longer contains "attachPilotMain("'
    ])
  })

  it('reports a missing file', () => {
    const root = fixtureRepo({
      'src/packages/pilot/HOOKS.md': TABLE,
      'src/main/a.ts': 'attachPilotMain('
    })
    expect(checkHooks({ repoRoot: root }).problems).toEqual([
      'hook "tsconfig-node": config/tsconfig.node.json is missing'
    ])
  })
})

describe('checkHooks on this repo', () => {
  it('passes for the real HOOKS.md', () => {
    const repoRoot = join(__dirname, '../../../..')
    const result = checkHooks({ repoRoot, upstreamRef: 'upstream/main' })
    expect(result.problems).toEqual([])
  })
})
