// Hook target: src/renderer/src/web/main.tsx (pilot-hook: web-renderer). The browser version attaches Pilot
// as its own chunk while the lazy app shell loads, after installWebPreloadApi() has run. A failed attach logs
// and still lets the shell load (R13).
export async function withPilotWebRenderer<T>(
  app: Promise<T>,
  attach: () => Promise<void> = () =>
    import('./attach-renderer').then((m) => m.attachPilotRenderer())
): Promise<T> {
  const attached = attach().catch((error: unknown) =>
    console.error(
      `[pilot] web renderer attach failed: ${error instanceof Error ? error.message : String(error)}`
    )
  )
  const [module] = await Promise.all([app, attached])
  return module
}
