// The root commands Pilot adds to the CLI (upstream already lists automations and linear). Import-free like
// upstream's src/main/startup/cli-command-names.ts, which spreads these in so a direct launch of Pilot's binary
// with one of them runs the CLI instead of booting the app.
export const PILOT_CLI_COMMAND_NAMES = ['action', 'inbox', 'run'] as const
