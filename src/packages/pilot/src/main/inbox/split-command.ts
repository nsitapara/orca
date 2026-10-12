// POSIX shell words, as Python's shlex.split reads a Run: line: quotes and backslash escapes.
export function splitCommand(text: string): string[] {
  const words: string[] = []
  let word = ''
  let started = false
  let quote: string | null = null
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (quote) {
      if (c === quote) {
        quote = null
      } else if (c === '\\' && quote === '"' && i + 1 < text.length) {
        i += 1
        word += text[i]
      } else {
        word += c
      }
    } else if (c === "'" || c === '"') {
      quote = c
      started = true
    } else if (c === '\\' && i + 1 < text.length) {
      i += 1
      word += text[i]
      started = true
    } else if (/\s/.test(c)) {
      if (started) {
        words.push(word)
      }
      word = ''
      started = false
    } else {
      word += c
      started = true
    }
  }
  if (started) {
    words.push(word)
  }
  return words
}
