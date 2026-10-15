import { describe, expect, it } from 'vitest'
import { emptyLog, feed, inWindow, toolTitle, type LogState } from './claude-log'
import { at, lines, result, say, T0, use } from './__fixtures__/transcript'

function parse(text: string): LogState {
  const state = emptyLog()
  feed(state, Buffer.from(text))
  return state
}

// The log line each entry shows, without what the reader keeps for itself.
function shown(state: LogState): unknown[] {
  return state.entries.map(
    ({ use: _u, result: _r, command: _c, git: _g, ids: _i, ...entry }) => entry
  )
}

describe('feed', () => {
  it('pairs each tool use with its result and gives it a status and a summary', () => {
    const state = parse(
      lines(
        use(1, 't1', 'Bash', { command: 'just test\n--verbose', description: 'run' }),
        result(2, 't1', 'a\nb\nc'),
        use(3, 't2', 'Bash', { command: 'false' }),
        result(4, 't2', 'Exit code 1\nboom happened', { error: true }),
        use(5, 't3', 'Bash', { command: 'sleep 99' }),
        result(6, 't3', 'stopped', { tur: { interrupted: true } }),
        use(7, 't4', 'Read', { file_path: '/wt/web-1/apps/x.ts' }),
        say(8, 'm1', 'Fixed it.\nMore detail')
      )
    )
    expect(shown(state)).toEqual([
      {
        kind: 'tool',
        id: 't1',
        at: T0 + 1000,
        tool: 'Bash',
        title: '$ just test',
        status: 'ok',
        summary: '3 lines',
        links: []
      },
      {
        kind: 'tool',
        id: 't2',
        at: T0 + 3000,
        tool: 'Bash',
        title: '$ false',
        status: 'error',
        summary: 'exit 1 · boom happened',
        links: []
      },
      {
        kind: 'tool',
        id: 't3',
        at: T0 + 5000,
        tool: 'Bash',
        title: '$ sleep 99',
        status: 'interrupted',
        summary: 'stopped',
        links: []
      },
      {
        kind: 'tool',
        id: 't4',
        at: T0 + 7000,
        tool: 'Read',
        title: 'Read apps/x.ts',
        status: 'pending',
        summary: null,
        links: []
      },
      { kind: 'text', id: 'm1:0', at: T0 + 8000, title: 'Fixed it.' }
    ])
  })

  it('reads only complete lines, so a half-written last line is read on the next feed', () => {
    const text = lines(use(1, 't1', 'Bash', { command: 'ls' }), result(2, 't1', 'x'))
    const state = emptyLog()
    feed(state, Buffer.from(text.slice(0, -10)))
    expect(shown(state)).toMatchObject([{ id: 't1', status: 'pending' }])
    expect(state.offset).toBe(text.indexOf('\n') + 1)
    feed(state, Buffer.from(text).subarray(state.offset))
    expect(shown(state)).toMatchObject([{ id: 't1', status: 'ok', summary: 'x' }])
    expect(state.offset).toBe(Buffer.byteLength(text))
  })

  it('skips malformed lines, sidechain records, thinking blocks and other record types', () => {
    const state = parse(
      `not json\n${lines(
        { ...use(1, 's1', 'Bash', { command: 'x' }), isSidechain: true },
        {
          type: 'assistant',
          timestamp: at(2),
          uuid: 'th',
          message: { content: [{ type: 'thinking', thinking: 'hmm' }] }
        },
        { type: 'attachment', timestamp: at(3) },
        { type: 'system', timestamp: at(4), subtype: 'turn_duration' },
        use(5, 't1', 'Bash', { command: 'ok' })
      )}`
    )
    expect(state.entries.map((e) => e.id)).toEqual(['t1'])
  })

  it("keeps a result's GitLab and Linear links, ticket identifiers and gitOperation", () => {
    const mr = 'https://gitlab.com/g/p/-/merge_requests/1631'
    const state = parse(
      lines(
        use(1, 't1', 'Bash', { command: 'glab mr create --fill' }),
        result(2, 't1', `${mr}.\nsee https://example.com/x`, {
          tur: { gitOperation: { pr: { number: 1631, url: mr, action: 'created' } } }
        }),
        use(3, 't2', 'Bash', { command: 'orca linear create --json' }),
        result(
          4,
          't2',
          '{"ok":true,"result":{"identifier":"WEB-2182","url":"https://linear.app/acme/issue/WEB-2182/x"}}'
        )
      )
    )
    expect(state.entries[0]).toMatchObject({
      links: [mr],
      git: { pr: { number: 1631 } },
      command: 'glab mr create --fill'
    })
    expect(state.entries[1]).toMatchObject({
      links: ['https://linear.app/acme/issue/WEB-2182/x'],
      ids: ['WEB-2182']
    })
  })

  it("counts an edit's added and removed lines from its patch", () => {
    const state = parse(
      lines(
        use(1, 'e1', 'Edit', { file_path: '/wt/web-1/a.ts', old_string: 'x', new_string: 'y' }),
        result(2, 'e1', 'ok', { tur: { structuredPatch: [{ lines: [' a', '-b', '+c', '+d'] }] } })
      )
    )
    expect(shown(state)).toMatchObject([{ title: 'Edit a.ts', summary: '+2 −1' }])
  })
})

describe('toolTitle', () => {
  it.each([
    ['Bash', { command: 'git status\nmore' }, '$ git status'],
    ['Read', { file_path: '/wt/web-1/src/a.ts' }, 'Read src/a.ts'],
    ['Write', { file_path: '/elsewhere/b.ts' }, 'Write /elsewhere/b.ts'],
    ['Grep', { pattern: 'foo' }, 'Grep foo'],
    ['Skill', { skill: 'dev-e2e-fix', args: 'WEB-1' }, 'Skill dev-e2e-fix WEB-1'],
    ['Agent', { description: 'Map hooks' }, 'Agent Map hooks'],
    ['WebFetch', { url: 'x' }, 'WebFetch']
  ])('titles %s', (name, input, title) => {
    expect(toolTitle(name, input, '/wt/web-1')).toBe(title)
  })
})

describe('inWindow', () => {
  it('keeps the entries inside a step and counts the ones after it', () => {
    const state = parse(
      lines(
        say(1, 'a', 'before'),
        say(10, 'b', 'inside'),
        say(20, 'c', 'after'),
        say(21, 'd', 'after too')
      )
    )
    const { inside, later } = inWindow(state.entries, T0 + 5000, T0 + 15000)
    expect(inside.map((e) => e.id)).toEqual(['b:0'])
    expect(later).toBe(2)
    expect(inWindow(state.entries, T0 + 5000, null)).toMatchObject({ later: 0 })
  })
})
