import { spawnProcess } from '@orca/process-host'
import { CODEX_SHORT_LIVED_PROBE_APP_SERVER_ARGS } from '../../../../../main/codex-cli/codex-read-only-app-server-args'
import {
  resolveCodexHomeProcessLockKey,
  withCodexHomeProcessLock
} from '../../../../../main/codex-cli/codex-home-process-lock'
import { resolveCodexCommand } from '../../../../../main/codex-cli/command'
import { terminateCodexProbeChild } from '../../../../../main/rate-limits/codex-probe-termination'
import {
  readCodexRateLimitsViaRpc,
  type CodexRpcRateLimitChild
} from '../../../../../main/rate-limits/codex-rpc-rate-limit-probe'
import { resolveHiddenRateLimitPtyCwd } from '../../../../../main/rate-limits/hidden-rate-limit-pty-cwd'
import { withCliRuntimeOnPath } from '../../../../../shared/node-cli-command-resolution'
import { codexQuotaReading, rateLimitsResultTap } from './codex-quota-reading'
import type { QuotaReader } from './quota'

// Orca's own probe timeouts (src/main/rate-limits/codex-fetcher.ts RPC_INIT_TIMEOUT_MS, RPC_TIMEOUT_MS).
const INIT_TIMEOUT_MS = 30_000
const RPC_TIMEOUT_MS = 10_000

// Imported only by attach-main.ts (R3): codex probing stays out of orcad's import graph.
// quota.py read_codex: one short-lived `codex app-server`, asked account/rateLimits/read. Orca's probe
// runs it; the tap keeps the raw answer, whose "out" flags Orca's reading drops. A failed read throws,
// so cachedQuotas keeps the last good reading (an hour), then reads null: the job runs.
export function codexQuotaReader(now: () => number = Date.now): QuotaReader {
  return () =>
    withCodexHomeProcessLock(resolveCodexHomeProcessLockKey(undefined), async () => {
      const command = resolveCodexCommand()
      const child = spawnProcess({
        program: command,
        args: [...CODEX_SHORT_LIVED_PROBE_APP_SERVER_ARGS],
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: resolveHiddenRateLimitPtyCwd(),
        env: withCliRuntimeOnPath(command, process.env)
      })
      const probe = child as CodexRpcRateLimitChild
      const answer = rateLimitsResultTap(probe.stdout)
      const limits = await readCodexRateLimitsViaRpc({
        child: probe,
        codexCommand: command,
        initTimeoutMs: INIT_TIMEOUT_MS,
        rpcTimeoutMs: RPC_TIMEOUT_MS,
        terminate: () => terminateCodexProbeChild(child)
      })
      const raw = answer()
      if (limits.status !== 'ok' || !raw) {
        throw new Error(`Codex usage unavailable (${limits.error ?? limits.status})`)
      }
      return codexQuotaReading(raw, now())
    })
}
