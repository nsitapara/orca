import { EventEmitter } from 'node:events'
import { readFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  TYPECHECK_PROJECTS,
  localTypecheckLimits,
  runTypecheckProjects
} from './run-typecheck-projects-in-parallel.mjs'

describe('local and CI compiler selection', () => {
  it('continues to later projects after a compiler exits with an error', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'orca-typecheck-failure-')))
    try {
      const compilerDir = join(root, 'node_modules', 'typescript')
      mkdirSync(compilerDir, { recursive: true })
      mkdirSync(join(root, 'config'))
      writeFileSync(
        join(compilerDir, 'package.json'),
        JSON.stringify({ name: 'typescript', bin: { tsc: 'compiler.cjs' } })
      )
      writeFileSync(
        join(compilerDir, 'compiler.cjs'),
        "const fs = require('node:fs'); const config = process.argv.at(-1); fs.appendFileSync('checked.txt', config + '\\n'); process.exit(config.includes('broken') ? 1 : 0)"
      )
      const failures = await runTypecheckProjects({
        root,
        projects: [
          { config: 'config/broken.json', heapGib: 1 },
          { config: 'config/healthy.json', heapGib: 1 }
        ],
        memoryBytes: 2 * 1024 ** 3,
        parallelism: 1
      })
      expect(failures).toHaveLength(1)
      expect(failures[0].message).toContain('broken.json exited with code 1')
      expect(readFileSync(join(root, 'checked.txt'), 'utf8')).toBe(
        'config/broken.json\nconfig/healthy.json\n'
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('local typecheck limits', () => {
  it.each([
    [{}, { jobs: 1, threads: 4 }],
    [
      { ORCA_TYPECHECK_JOBS: '', ORCA_TYPECHECK_THREADS: '' },
      { jobs: 1, threads: 4 }
    ],
    [
      { ORCA_TYPECHECK_JOBS: '2', ORCA_TYPECHECK_THREADS: '8' },
      { jobs: 2, threads: 8 }
    ]
  ])('reads %j as %j', (env, limits) => {
    expect(localTypecheckLimits(env)).toEqual(limits)
  })

  it.each([
    ['ORCA_TYPECHECK_JOBS', '0'],
    ['ORCA_TYPECHECK_THREADS', '1.5'],
    ['ORCA_TYPECHECK_THREADS', 'all']
  ])('refuses %s=%s', (name, raw) => {
    expect(() => localTypecheckLimits({ [name]: raw })).toThrow(
      `${name} must be a positive integer, not ${raw}`
    )
  })

  it('runs one native compiler at a time, each capped to the thread limit', async () => {
    let active = 0
    let peak = 0
    const spawnCompiler = vi.fn(() => {
      const child = new EventEmitter()
      active++
      peak = Math.max(peak, active)
      setImmediate(() => {
        active--
        child.emit('close', 0, null)
      })
      return child
    })
    const failures = await runTypecheckProjects({ spawnCompiler, parallelism: 1, threads: 4 })
    expect(failures).toEqual([])
    expect(peak).toBe(1)
    expect(spawnCompiler.mock.calls.map(([spec]) => spec.env.GOMAXPROCS)).toEqual(
      TYPECHECK_PROJECTS.map(() => '4')
    )
  })
})
