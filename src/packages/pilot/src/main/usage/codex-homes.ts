import { join } from 'node:path'

// Where a Codex rollout can live: $CODEX_HOME, ~/.codex, and the Codex runtime homes Orca and Pilot keep, which
// hard-link most rollouts from ~/.codex but hold some of their own (usage.py's CODEX_HOMES, plus Pilot's).
export function codexHomes(codexHome: string | undefined, home: string): string[] {
  const support = join(home, 'Library', 'Application Support')
  return [
    codexHome?.trim(),
    join(home, '.codex'),
    join(support, 'orca', 'codex-runtime-home', 'home'),
    join(support, 'Pilot', 'codex-runtime-home', 'home')
  ].filter((d): d is string => Boolean(d))
}
