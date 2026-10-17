// Hook target: src/renderer/src/web/main.tsx (pilot-hook: web-renderer). The browser version attaches Pilot
// as its own chunk while the lazy app shell loads, after installWebPreloadApi() has run. A failed attach logs
// and still lets the shell load (R13).
let attaching: Promise<void> | null = null

function attachChunk(): Promise<void> {
  return import('./attach-renderer').then((m) => m.attachPilotRenderer())
}

// Why cached: lazyWithRetry runs this again on each app shell retry, and a second attach doubles every subscription.
function attachOnce(attach: () => Promise<void>): Promise<void> {
  if (!attaching) {
    attaching = attach().catch((error: unknown) => {
      // A chunk that failed to load is tried again on the next app shell load.
      attaching = null
      console.error(
        `[pilot] web renderer attach failed: ${error instanceof Error ? error.message : String(error)}`
      )
    })
  }
  return attaching
}

export async function withPilotWebRenderer<T>(
  app: Promise<T>,
  attach: () => Promise<void> = attachChunk
): Promise<T> {
  const [module] = await Promise.all([app, attachOnce(attach)])
  return module
}
