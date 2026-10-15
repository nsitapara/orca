import { appendFileSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LogReader, NOT_UNDER_ROOT } from './log-file'
import { lines, result, use } from './__fixtures__/transcript'

function rootWith(text: string): { root: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), 'pilot-log-'))
  mkdirSync(join(root, 'proj'))
  const file = join(root, 'proj', 's1.jsonl')
  writeFileSync(file, text)
  return { root, file }
}

describe('LogReader', () => {
  it('parses a transcript once and then only what was appended, a half-written line included', async () => {
    const first = lines(use(1, 't1', 'Bash', { command: 'ls' }))
    const { root, file } = rootWith(`${first}{"type":"us`)
    const reader = new LogReader(root)
    expect((await reader.read(file)).entries.map((e) => e.id)).toEqual(['t1'])
    const rest = lines(result(2, 't1', 'x'))
    writeFileSync(file, first + rest)
    const state = await reader.read(file)
    expect(state.entries).toMatchObject([{ id: 't1', status: 'ok' }])
    appendFileSync(file, lines(use(3, 't2', 'Bash', { command: 'pwd' })))
    expect((await reader.read(file)).entries.map((e) => e.id)).toEqual(['t1', 't2'])
  })

  it('starts over when the file got shorter (rewritten)', async () => {
    const { root, file } = rootWith(
      lines(use(1, 't1', 'Bash', { command: 'ls' }), use(2, 't2', 'Bash', { command: 'ls' }))
    )
    const reader = new LogReader(root)
    await reader.read(file)
    writeFileSync(file, lines(use(1, 't9', 'Bash', { command: 'ls' })))
    expect((await reader.read(file)).entries.map((e) => e.id)).toEqual(['t9'])
  })

  it('refuses a path outside its root, a symlink pointing out included', async () => {
    const { root } = rootWith('')
    const outside = mkdtempSync(join(tmpdir(), 'pilot-out-'))
    const target = join(outside, 'x.jsonl')
    writeFileSync(target, lines(use(1, 't1', 'Bash', { command: 'ls' })))
    symlinkSync(target, join(root, 'proj', 'link.jsonl'))
    const reader = new LogReader(root)
    await expect(reader.read(target)).rejects.toThrow(NOT_UNDER_ROOT)
    await expect(reader.read(join(root, 'proj', 'link.jsonl'))).rejects.toThrow(NOT_UNDER_ROOT)
  })

  it('reads back the bytes of one span', async () => {
    const text = lines(use(1, 't1', 'Bash', { command: 'ls' }))
    const { root, file } = rootWith(text)
    const reader = new LogReader(root)
    const state = await reader.read(file)
    const tool = state.entries[0]
    expect(JSON.parse(await reader.span(file, tool.use))).toMatchObject({ uuid: 'u-t1' })
  })
})
