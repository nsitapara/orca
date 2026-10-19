// runLinearAgentWrite's write deadline (runtime-linear-comment-lookup-commands.ts): a stalled sign frees its slot.
export const LINEAR_UPLOAD_SIGN_TIMEOUT_MS = 25_000
// One screenshot's PUT to storage; it holds no Linear request slot, so it may outlast a Linear write.
export const LINEAR_UPLOAD_PUT_TIMEOUT_MS = 120_000
// The team lookup, the create, its read-back and the MR attach, each under a Linear deadline of at most 30s.
const CREATE_WITHOUT_UPLOADS_MS = 120_000

// The longest Create can take on the server when it uploads this many screenshots.
export function ticketCreateDeadlineMs(screenshots: number): number {
  const perScreenshot = LINEAR_UPLOAD_SIGN_TIMEOUT_MS + LINEAR_UPLOAD_PUT_TIMEOUT_MS
  return CREATE_WITHOUT_UPLOADS_MS + screenshots * perScreenshot
}
