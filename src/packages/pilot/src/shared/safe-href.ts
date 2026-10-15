// A link Pilot may make clickable: only http and https, since the url came out of a transcript or an action's output.
export function safeHref(url: string | null): string | null {
  if (!url) {
    return null
  }
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:' ? url : null
  } catch {
    return null
  }
}
