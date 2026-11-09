/**
 * Shorter forms of `text` that keep its last `tail` parts and drop parts from the middle, longest
 * first: "Fix hourly e2e failure … and 1 more", "web-2642-fix-…-e2e-staff". Empty when there is no
 * middle to drop.
 */
export function middleCutCandidates(text: string, tail: number, separator: ' ' | '-'): string[] {
  const parts = text.split(separator)
  if (parts.length <= tail + 1) {
    return []
  }
  const end = parts.slice(-tail).join(separator)
  const gap = separator === ' ' ? ' … ' : '-…-'
  const candidates: string[] = []
  for (let kept = parts.length - tail - 1; kept >= 1; kept--) {
    candidates.push(parts.slice(0, kept).join(separator) + gap + end)
  }
  return candidates
}

function fits(element: HTMLElement): boolean {
  return (
    element.scrollWidth <= element.clientWidth + 1 &&
    element.scrollHeight <= element.clientHeight + 1
  )
}

/**
 * Writes the longest form of `text` that fits `element`, keeping `tail` end parts, then fewer when
 * even the shortest form with them doesn't fit; the shortest form when none does.
 */
export function fitMiddleCut(
  element: HTMLElement,
  text: string,
  tail: number,
  separator: ' ' | '-'
): void {
  element.textContent = text
  if (fits(element)) {
    return
  }
  for (let kept = tail; kept >= 1; kept--) {
    for (const candidate of middleCutCandidates(text, kept, separator)) {
      element.textContent = candidate
      if (fits(element)) {
        return
      }
    }
  }
}
