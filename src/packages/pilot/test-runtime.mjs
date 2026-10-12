// Pilot tests that need real node:sqlite. Bun has none, so config/scripts/vitest-sqlite-runtime-files.mjs
// (pilot-hook: vitest-sqlite-runtime) spreads this list into upstream's Node-runtime project.
export const PILOT_SQLITE_RUNTIME_INCLUDE = [
  'src/packages/pilot/src/main/store/store.test.ts',
  'src/packages/pilot/src/main/scheduler/tick-runner.test.ts',
  'src/packages/pilot/src/main/rpc/run-channel.test.ts',
  'src/packages/pilot/src/main/rpc/automation-files.test.ts',
  'src/packages/pilot/src/main/run/watcher.test.ts',
  'src/packages/pilot/src/main/run/launch.test.ts',
  'src/packages/pilot/src/main/run/stale-starts.test.ts',
  'src/packages/pilot/src/main/store/store-advance.test.ts',
  'src/packages/pilot/src/main/run/advance.test.ts',
  'src/packages/pilot/src/main/run/engine-wiring.test.ts',
  'src/packages/pilot/src/main/run/shell-step.test.ts',
  'src/packages/pilot/src/main/rpc/methods.test.ts',
  'src/packages/pilot/src/main/rpc/handlers.test.ts',
  'src/packages/pilot/src/main/pilot-services.test.ts',
  'src/packages/pilot/src/main/inbox/inbox-service.test.ts',
  'src/packages/pilot/src/main/inbox/retire.test.ts',
  'src/packages/pilot/src/main/vault/export.test.ts',
  'src/packages/pilot/src/main/rpc/methods-inbox.test.ts',
  'src/packages/pilot/scripts/seed-handled-from-sweep.test.ts',
  'src/packages/pilot/scripts/import-orca-settings.test.ts',
  'src/packages/pilot/test/parity/05-fix-failed-ci.parity.test.ts'
]
