// Shared command runner for Pilot scripts. Orca's process-host ratchet forbids direct
// child_process imports, so scripts spawn through @orca/process-host.
import { runProcessSync, spawnProcess } from '@orca/process-host'

export function run(cmd, args, opts = {}) {
  return runProcessSync({
    program: cmd,
    args,
    cwd: opts.cwd,
    env: opts.env,
    timeoutMs: opts.timeoutMs
  })
}

// Long-running commands (pnpm dev): inherit stdio and resolve to the exit code.
export function runInherit(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawnProcess({
      program: cmd,
      args,
      cwd: opts.cwd,
      env: opts.env,
      stdio: 'inherit'
    })
    child.on('error', () => resolve(1))
    child.on('exit', (code) => resolve(code ?? 0))
  })
}
