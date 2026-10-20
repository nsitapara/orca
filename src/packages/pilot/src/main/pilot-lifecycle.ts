export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// One failing part of a scheduler pass (answers, the vault export) never stops the others (R13).
export async function softly(
  what: string,
  work: () => unknown,
  log: (message: string) => void
): Promise<void> {
  try {
    await work()
  } catch (error) {
    log(`[pilot] ${what} failed: ${messageOf(error)}`)
  }
}

// Newest first: the scheduler stops before the watcher, and both before the store closes.
export function closeAll(opened: (() => void)[], log: (message: string) => void): void {
  while (opened.length > 0) {
    const close = opened.pop()!
    try {
      close()
    } catch (error) {
      log(`[pilot] couldn't close cleanly: ${messageOf(error)}`)
    }
  }
}
