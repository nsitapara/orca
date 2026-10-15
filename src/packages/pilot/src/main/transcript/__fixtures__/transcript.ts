// Synthetic Claude Code transcript records, one JSON object per line. No real ticket or comment text.
export const T0 = Date.parse('2026-10-15T18:35:00.000Z')

export function at(sec: number): string {
  return new Date(T0 + sec * 1000).toISOString()
}

export function use(
  sec: number,
  id: string,
  name: string,
  input: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    type: 'assistant',
    timestamp: at(sec),
    uuid: `u-${id}`,
    cwd: '/wt/web-1',
    message: { content: [{ type: 'tool_use', id, name, input }] },
    ...extra
  }
}

export function result(
  sec: number,
  id: string,
  content: unknown,
  opts: { error?: boolean; tur?: unknown } = {}
): Record<string, unknown> {
  return {
    type: 'user',
    timestamp: at(sec),
    uuid: `r-${id}`,
    message: {
      content: [{ type: 'tool_result', tool_use_id: id, content, is_error: opts.error ?? false }]
    },
    toolUseResult: opts.tur
  }
}

export function say(sec: number, uuid: string, text: string): Record<string, unknown> {
  return {
    type: 'assistant',
    timestamp: at(sec),
    uuid,
    message: { content: [{ type: 'text', text }] }
  }
}

export function lines(...records: unknown[]): string {
  return `${records.map((r) => JSON.stringify(r)).join('\n')}\n`
}
