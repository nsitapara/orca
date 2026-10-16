import {
  hydrateShellPath,
  mergePathSegments,
  type HydrationResult
} from '../../../../../main/startup/hydrate-shell-path'

export type LoginPathDeps = {
  probe(force: boolean): Promise<HydrationResult>
  merge(segments: string[]): void
  log(message: string): void
}

// Forced probes after the startup one fails; each gives up after upstream's 10s.
export const LOGIN_PATH_RETRIES = 2

const defaultDeps: LoginPathDeps = {
  probe: (force) => hydrateShellPath(force ? { force: true } : undefined),
  merge: (segments) => {
    mergePathSegments(segments)
  },
  log: (message) => console.log(message)
}

// The login shell's PATH, which the scheduler waits for before any step runs. A Pilot opened from the Dock starts with
// launchd's PATH, and upstream's startup probe puts the login shell's in front. That probe gives up after 10s, and the
// Keychain prompt at launch can hold the main thread longer: the probe's timer then fires before the shell's answer is
// read, and steps get the seeded PATH, where /usr/bin's python3 (3.9) comes before Homebrew's. Once the probe has
// failed the thread is free again, so probing again works.
export async function loginPath(deps: LoginPathDeps = defaultDeps): Promise<void> {
  let result = await deps.probe(false)
  for (let tries = 0; !result.ok && tries < LOGIN_PATH_RETRIES; tries++) {
    deps.log(`[pilot] login-shell PATH probe failed (${result.failureReason}); probing again`)
    result = await deps.probe(true)
  }
  if (result.ok) {
    deps.merge(result.segments)
    return
  }
  deps.log(
    `[pilot] login-shell PATH probe failed (${result.failureReason}); steps run with Pilot's seeded PATH`
  )
}
