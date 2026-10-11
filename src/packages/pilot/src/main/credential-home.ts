import { homedir } from 'node:os'
import { join } from 'node:path'

// Hook target: src/main/linear/linear-credential-paths.ts (pilot-hook: linear-credential-home). Upstream
// keeps Linear's tokens in ~/.orca, encrypted with the app's own keychain key: Pilot can't read Orca's,
// and a Linear login in Pilot would overwrite them and break Orca's. Pilot keeps its own in ~/.pilot.
export function pilotCredentialHome(
  opts: { home?: string; inElectron?: boolean } = {}
): string | null {
  const inElectron = opts.inElectron ?? Boolean(process.versions.electron)
  // Why: upstream's Linear tests run under plain Node and keep upstream's ~/.orca.
  if (!inElectron) {
    return null
  }
  return join(opts.home ?? homedir(), '.pilot')
}
