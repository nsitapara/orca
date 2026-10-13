import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PUSH_DIFF_ARGS } from '../../src/main/inbox/push-range'
import { skillsDir } from './old-side'

// One definition of a pushed range's diff: the worker makes a push's patch with context.py push-patch, and Pilot
// recomputes it with PUSH_DIFF_ARGS. They must be the same command, or no prepared push could ever pass.
const SCRIPTS = join(skillsDir(), 'prepare-inbox-item-context', 'scripts')

describe.skipIf(
  !existsSync(join(SCRIPTS, 'context.py')) || spawnSync('python3', ['--version']).status !== 0
)('the canonical push diff', () => {
  it("is context.py's PUSH_DIFF", () => {
    const read = spawnSync(
      'python3',
      [
        '-c',
        'import json, sys; sys.path.insert(0, sys.argv[1]); import context; print(json.dumps(context.PUSH_DIFF))',
        SCRIPTS
      ],
      { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }
    )
    expect(read.stderr).toBe('')
    expect([...JSON.parse(read.stdout), 'BASE', 'HEAD']).toEqual(PUSH_DIFF_ARGS('BASE', 'HEAD'))
  })
})
