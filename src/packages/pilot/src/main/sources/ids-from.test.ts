import { describe, expect, it, vi } from 'vitest'
import {
  IDS_OUTPUT_CAP,
  MAX_IDS,
  idsFromOutput,
  inheritedIdsEnv,
  readIdsFrom,
  runIdsCommand,
  type IdsCommand,
  type IdsCommandResult,
  type IdsRunner
} from './ids-from'

const ENGINE = { binDir: '/app/bin', dataDir: '/data/Pilot' }
const OPTS = {
  automationId: 'dev-e2e-fix-start',
  file: '/autos/dev-e2e-fix-start.yaml',
  repoPath: '/repo',
  engineEnv: ENGINE,
  baseEnv: { PATH: '/usr/bin', HOME: '/Users/n' }
}
const result = (over: Partial<IdsCommandResult>): IdsCommandResult => ({
  code: 0,
  stdout: '',
  stderr: '',
  timedOut: false,
  truncated: false,
  ...over
})
function runner(over: Partial<IdsCommandResult>): IdsRunner & { calls: IdsCommand[] } {
  const calls: IdsCommand[] = []
  const run = vi.fn(async (cmd: IdsCommand) => {
    calls.push(cmd)
    return result(over)
  })
  return Object.assign(run, { calls })
}
const envelope = (data: unknown) =>
  JSON.stringify({ v: 1, command: 'list-fix-tickets', outcome: 'ok', reason: 'r', data, meta: {} })

describe('idsFromOutput: the ids in what the command printed', () => {
  it.each([
    ['a plain array of strings', '["WEB-1", "WEB-2"]', undefined, ['WEB-1', 'WEB-2']],
    ['an envelope of strings', envelope(['WEB-1']), undefined, ['WEB-1']],
    [
      'an envelope of objects, picked by field',
      envelope([{ identifier: 'WEB-2', branch: 'b' }, { identifier: 'WEB-1' }]),
      'identifier',
      ['WEB-2', 'WEB-1']
    ],
    ['an array of objects with integer ids', '[{"iid": 1587}, {"iid": 12}]', 'iid', ['1587', '12']],
    [
      'repeats kept once, first place wins',
      '["WEB-2", "WEB-1", "WEB-2"]',
      undefined,
      ['WEB-2', 'WEB-1']
    ],
    ['an empty list', '[]', undefined, []]
  ])('%s', (_name, stdout, field, ids) => {
    expect(idsFromOutput(stdout, field)).toEqual(ids)
  })

  it.each([
    ['not JSON', 'WEB-1\nWEB-2', undefined, "isn't JSON"],
    [
      'an object without a data list',
      '{"data": "WEB-1"}',
      undefined,
      'a JSON list, or an envelope whose data is a list'
    ],
    ['a number', '3', undefined, 'a JSON list, or an envelope whose data is a list'],
    ['objects without field', '[{"identifier": "WEB-1"}]', undefined, 'item 1 is not a string'],
    ['strings with a field', '["WEB-1"]', 'identifier', 'item 1 has no "identifier"'],
    [
      'an object missing the field',
      '[{"identifier": "WEB-1"}, {"id": "x"}]',
      'identifier',
      'item 2 has no "identifier"'
    ],
    ['an empty id', '[""]', undefined, 'item 1 is not a usable id'],
    ['an id with a space', '["WEB 1"]', undefined, 'item 1 is not a usable id'],
    ['a fractional number', '[{"iid": 1.5}]', 'iid', 'item 1 has no "iid"']
  ])('refuses %s', (_name, stdout, field, error) => {
    expect(() => idsFromOutput(stdout, field)).toThrow(error)
  })

  it(`refuses more than ${MAX_IDS} ids`, () => {
    const many = JSON.stringify(Array.from({ length: MAX_IDS + 1 }, (_, i) => `WEB-${i}`))
    expect(() => idsFromOutput(many, undefined)).toThrow(`more than ${MAX_IDS} ids`)
  })
})

describe('readIdsFrom: one run of the command', () => {
  it('runs the words as argv, without a shell, in the main checkout, with a timeout and an output cap', async () => {
    const run = runner({ stdout: envelope([{ identifier: 'WEB-1' }]) })
    const ids = await readIdsFrom(
      { run: "python3 '/a b/pilot_mode.py' list-fix-tickets", field: 'identifier', timeout: '30s' },
      OPTS,
      run
    )
    expect(ids).toEqual(['WEB-1'])
    expect(run.calls[0]).toMatchObject({
      program: 'python3',
      args: ['/a b/pilot_mode.py', 'list-fix-tickets'],
      cwd: '/repo',
      timeoutMs: 30_000,
      maxOutputBytes: IDS_OUTPUT_CAP
    })
  })

  it('defaults to a 60s timeout and resolves a ./ program against the automation file', async () => {
    const run = runner({ stdout: '[]' })
    await readIdsFrom({ run: './ids.sh --open' }, OPTS, run)
    expect(run.calls[0]).toMatchObject({
      program: '/autos/ids.sh',
      args: ['--open'],
      timeoutMs: 60_000
    })
  })

  it("gives the command Pilot's bin and data folder and the YAML's env, never a dangerous inherited name", async () => {
    const run = runner({ stdout: '[]' })
    const baseEnv = {
      PATH: '/usr/bin',
      HOME: '/Users/n',
      LANG: 'en_US.UTF-8',
      BASH_ENV: '/tmp/evil',
      ENV: '/tmp/evil',
      DYLD_INSERT_LIBRARIES: '/tmp/x.dylib',
      LD_PRELOAD: '/tmp/x.so',
      NODE_OPTIONS: '--require /tmp/x.js',
      PYTHONSTARTUP: '/tmp/x.py',
      GIT_CONFIG_COUNT: '1'
    }
    await readIdsFrom({ run: 'tool', env: { LOOP: 'dev-e2e' } }, { ...OPTS, baseEnv }, run)
    expect(run.calls[0].env).toEqual({
      PATH: '/app/bin:/usr/bin',
      HOME: '/Users/n',
      LANG: 'en_US.UTF-8',
      ORCA_USER_DATA_PATH: '/data/Pilot',
      PILOT_AUTOMATION_ID: 'dev-e2e-fix-start',
      LOOP: 'dev-e2e'
    })
  })

  it('reads exit 3 as no ids, whatever it printed', async () => {
    expect(await readIdsFrom({ run: 'tool' }, OPTS, runner({ code: 3, stdout: 'none' }))).toEqual(
      []
    )
  })

  it.each([
    [
      'another exit',
      { code: 1, stderr: 'trace\nKeyError: tickets\n' },
      'ids_from exited 1: KeyError: tickets'
    ],
    ['a signal', { code: null }, 'ids_from was stopped by a signal'],
    ['a timeout', { code: null, timedOut: true }, 'ids_from timed out after 60s'],
    [
      'output past the cap',
      { truncated: true },
      `ids_from printed more than ${IDS_OUTPUT_CAP} bytes`
    ],
    ['exit 0 with bad output', { stdout: 'nope' }, "ids_from: its output isn't JSON"]
  ])('fails the tick on %s', async (_name, over, error) => {
    await expect(readIdsFrom({ run: 'tool' }, OPTS, runner(over))).rejects.toThrow(error)
  })

  it("fails the tick when the command can't start", async () => {
    const run: IdsRunner = async () => {
      throw new Error('spawn tool ENOENT')
    }
    await expect(readIdsFrom({ run: 'tool' }, OPTS, run)).rejects.toThrow(
      "ids_from couldn't start: spawn tool ENOENT"
    )
  })

  it('refuses a command a file could only carry by skipping validation', async () => {
    const run = runner({ stdout: '[]' })
    await expect(readIdsFrom({ run: 'tool | sh' }, OPTS, run)).rejects.toThrow('shell syntax')
    await expect(readIdsFrom({ run: 'tool {ticket.id}' }, OPTS, run)).rejects.toThrow(
      'placeholders'
    )
    expect(run.calls).toEqual([])
  })
})

describe('inheritedIdsEnv', () => {
  it('keeps ordinary names and drops what changes how a shell, the loader or an interpreter starts', () => {
    expect(
      inheritedIdsEnv({
        USER: 'n',
        TMPDIR: '/t',
        IFS: ' ',
        PS4: 'x',
        DYLD_LIBRARY_PATH: '/x',
        UNSET: undefined
      })
    ).toEqual({ USER: 'n', TMPDIR: '/t' })
  })
})

describe('runIdsCommand: the real process', () => {
  it('stops a command that prints past the cap and says so', async () => {
    const out = await runIdsCommand({
      program: process.execPath,
      args: ['-e', 'process.stdout.write("x".repeat(5000)); setInterval(() => {}, 1000)'],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? '' },
      timeoutMs: 10_000,
      maxOutputBytes: 100
    })
    expect(out).toMatchObject({ truncated: true, timedOut: false })
  })

  it('passes each word as one argument, with no shell to split or expand it', async () => {
    const out = await runIdsCommand({
      program: process.execPath,
      args: [
        '-e',
        'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
        'a b',
        '$HOME',
        '*'
      ],
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? '' },
      timeoutMs: 10_000,
      maxOutputBytes: 1000
    })
    expect(JSON.parse(out.stdout)).toEqual(['a b', '$HOME', '*'])
  })
})
