import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DETAILS_LIMITS } from '../../src/shared/details'
import { detailsFixture, rewriteBundle } from '../../src/main/inbox/__fixtures__/details-fixture'
import { loadDetails } from '../../src/main/inbox/details-bundle'
import { validatePreparationEvidence } from '../../src/main/inbox/details-preparation'
import { skillsDir } from './old-side'

// details.py, at its own caps, trims a patch of a renamed file, a file past the row cap (omitted), 59 small new files
// and a new file without a final newline: it shows the first 60 and counts the rest in more_files. What it writes must
// pass Pilot's exact check of a prepared diff against the hashed patch, and both sides must share the caps.
const small = (n: number) => [
  `diff --git a/s${n}.ts b/s${n}.ts`,
  'new file mode 100644',
  '--- /dev/null',
  `+++ b/s${n}.ts`,
  '@@ -0,0 +1 @@',
  `+small ${n}`
]
const PATCH = [
  'diff --git a/old.ts b/new.ts',
  'similarity index 80%',
  'rename from old.ts',
  'rename to new.ts',
  '--- a/old.ts',
  '+++ b/new.ts',
  '@@ -3,3 +3,3 @@ export function f() {',
  '   const a = 1',
  '-  return a',
  '+  return a + 1',
  ' }',
  'diff --git a/big.ts b/big.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/big.ts',
  '@@ -0,0 +1,4001 @@',
  ...Array.from({ length: 4001 }, (_, n) => `+row ${n}`),
  ...Array.from({ length: 59 }, (_, n) => small(n)).flat(),
  'diff --git a/n.ts b/n.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/n.ts',
  '@@ -0,0 +1,2 @@',
  '+a',
  '+b',
  '\\ No newline at end of file',
  ''
].join('\n')

const SCRIPT = `
import json, sys
sys.path.insert(0, sys.argv[1])
import details
block = details.diff_from_patch(open(sys.argv[2]).read())
print(json.dumps({"caps": [details.MAX_FILES, details.MAX_ROWS], "block": block}))
`
const DETAILS_PY = join(skillsDir(), 'worktree-gate', 'details.py')
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

describe.skipIf(!existsSync(DETAILS_PY) || spawnSync('python3', ['--version']).status !== 0)(
  "details.py's trimmed diff against Pilot's prepared-diff check",
  () => {
    it('passes as written: a rename shown, a big file omitted, two files counted in more_files', () => {
      const f = detailsFixture()
      writeFileSync(join(f.dir, 'F2.patch'), PATCH)
      const made = spawnSync(
        'python3',
        ['-c', SCRIPT, join(skillsDir(), 'worktree-gate'), join(f.dir, 'F2.patch')],
        { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }
      )
      expect(made.stderr).toBe('')
      const { caps, block } = JSON.parse(made.stdout) as {
        caps: [number, number]
        block: {
          files: { path: string; old_path: string | null; omitted?: boolean }[]
          more_files?: number
        }
      }
      expect(caps).toEqual([DETAILS_LIMITS.diffFiles, DETAILS_LIMITS.diffRows])
      expect(
        block.files.slice(0, 3).map((file) => [file.path, file.old_path, file.omitted ?? false])
      ).toEqual([
        ['new.ts', 'old.ts', false],
        ['big.ts', null, true],
        ['s0.ts', null, false]
      ])
      expect([block.files.length, block.more_files]).toEqual([60, 2])
      writeFileSync(join(f.dir, 'checks.log'), 'ok')
      rewriteBundle(f.bundle, (bundle) => {
        const patch = hash(PATCH)
        const diff = {
          ...block,
          type: 'diff',
          base: '7'.repeat(40),
          patch: 'F2.patch',
          patch_sha256: patch,
          check_records: [
            {
              command: 'pnpm test',
              exit_code: 0,
              output: 'checks.log',
              output_sha256: hash('ok'),
              base: '7'.repeat(40),
              patch_sha256: patch
            }
          ]
        }
        bundle.blocks = bundle.blocks
          .filter((b) => b.type !== 'missing')
          .map((b) => (b.type === 'diff' ? diff : b))
      })
      const snapshot = loadDetails(f.root, f.bundle, { prepared: true })
      expect(validatePreparationEvidence(snapshot, ['context', 'diff', 'checks'])).toEqual([])
    })
  }
)
