// Single-quotes a value for /bin/sh: an embedded single quote becomes '\''.
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}
