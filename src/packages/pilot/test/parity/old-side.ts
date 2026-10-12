import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const PARITY_DIR = import.meta.dirname
export type OldDecision = { key: string; label: string; decision: string; reason: string }

export function skillsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.PARITY_SKILLS_DIR ?? join(homedir(), '.agents', 'skills')
}

// The old side needs python3 and the job's own code (<folder>/<script>: a sweep's sweep.py by default; 12's
// worktree-gate/apply.py, 03's review-cycles/loop.py). Without either, a parity test skips.
export function canRunOldSide(folder: string, script = 'sweep.py'): boolean {
  const skills = skillsDir()
  if (
    !existsSync(join(skills, folder, script)) ||
    !existsSync(join(skills, 'worktree-gate', 'gate.py'))
  ) {
    return false
  }
  return spawnSync('python3', ['--version']).status === 0
}

// Replays the job's old plan on a fixture. Nothing runs (parity_io answers every read), and no
// bytecode is written into ~/.agents/skills.
export function runOldPlan(job: string, fixturePath: string): OldDecision[] {
  const result = spawnSync('python3', [join(PARITY_DIR, 'run_old_plan.py'), job, fixturePath], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
  })
  if (result.status !== 0) {
    throw new Error(
      `The old side of ${job} stopped (exit ${result.status}): ${(result.stderr ?? '').trim()}`
    )
  }
  return (JSON.parse(result.stdout) as { decisions: OldDecision[] }).decisions
}
