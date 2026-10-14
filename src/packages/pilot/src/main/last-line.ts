// The last non-blank line of some output, trimmed; '' when there is none. What a failed command "said last".
export function lastLine(text: string): string {
  return text.trim().split('\n').at(-1)?.trim() ?? ''
}
