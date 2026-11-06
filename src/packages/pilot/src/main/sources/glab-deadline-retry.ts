// A glab call killed at its deadline (glab-exec-file's 30 s) is tried once more: a stalled connection or a call that
// straddled the Mac's sleep usually answers at once the second time. Only reads come through here, so a retry never
// repeats a write. Any other failure, an abort included, is thrown as it is.
export function isDeadlineKill(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name !== 'AbortError' &&
    (error as { killed?: unknown }).killed === true &&
    error.message.endsWith('timed out.')
  )
}

export async function retryDeadlineKill<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (error) {
    if (!isDeadlineKill(error)) {
      throw error
    }
    return call()
  }
}
