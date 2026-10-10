// Shared command runner for Pilot scripts. Orca's process-host ratchet forbids direct
// child_process imports, so scripts spawn through @orca/process-host.
import { runProcessSync } from '@orca/process-host'

export function run(cmd, args, opts = {}) {
  return runProcessSync({
    program: cmd,
    args,
    cwd: opts.cwd,
    env: opts.env,
    timeoutMs: opts.timeoutMs
  })
}
