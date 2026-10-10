import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from './run.mjs'
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

function git(root: string, ...args: string[]): void {
  const result = run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root })
  expect(result.code, result.stderr).toBe(0)
}

const HOOK_TABLE = [
  '| Hook | File | Match | Why |',
  '|---|---|---|---|',
  '| cfg | config/a.json | pilot | listed |'
].join('\n')

describe('checkHooks upstream diff', () => {
  it('flags only the unlisted changed file', () => {
    const root = fixtureRepo({
      'src/packages/pilot/HOOKS.md': HOOK_TABLE,
      'config/a.json': 'pilot',
      'src/other.ts': 'a'
    })
    git(root, 'init', '-q')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'base')
    git(root, 'branch', 'up')
    writeFileSync(join(root, 'config/a.json'), 'pilot changed')
    writeFileSync(join(root, 'src/other.ts'), 'b')
    git(root, 'commit', '-q', '-am', 'change')
    expect(checkHooks({ repoRoot: root, upstreamRef: 'up' }).problems).toEqual([
      "src/other.ts differs from up but isn't a hook in HOOKS.md"
    ])
  })

  it('fails loudly when the upstream ref does not exist', () => {
    const root = fixtureRepo({
      'src/packages/pilot/HOOKS.md': HOOK_TABLE,
      'config/a.json': 'pilot'
    })
    git(root, 'init', '-q')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'base')
    const result = checkHooks({ repoRoot: root, upstreamRef: 'upstream/main' })
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      'upstream ref "upstream/main" not found: run git fetch upstream first'
    ])
  })
})

describe('checkHooks on this repo', () => {
  it('passes for the real HOOKS.md', () => {
    const repoRoot = join(__dirname, '../../../..')
    const hasUpstream =
      run('git', ['rev-parse', '--verify', '--quiet', 'upstream/main'], { cwd: repoRoot }).code ===
      0
    const result = checkHooks({ repoRoot, upstreamRef: hasUpstream ? 'upstream/main' : undefined })
    expect(result.problems).toEqual([])
  })
})
