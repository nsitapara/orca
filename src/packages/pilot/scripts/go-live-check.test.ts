import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- .mjs script without type declarations
import {
  agentCommands,
  assertScratch,
  automationFiles,
  checkAutomations,
  dryRunLine,
  parityRows,
  renderSummary,
  repeatedAgentFlags,
  settingsFromData
} from './go-live-check.mjs'

const decisions = (...verdicts: string[]) =>
  verdicts.map((verdict, i) => ({ key: `k${i}`, verdict }))

describe('automationFiles', () => {
  it('lists the automation files, never people.yaml or hidden files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pilot-golive-'))
    for (const name of [
      'fix-failed-ci.yaml',
      'pull-dev.yml',
      'people.yaml',
      '.draft.yaml',
      'notes.md'
    ]) {
      writeFileSync(join(dir, name), '')
    }
    expect(automationFiles(dir)).toEqual([
      join(dir, 'fix-failed-ci.yaml'),
      join(dir, 'pull-dev.yml')
    ])
  })
})

describe('dryRunLine', () => {
  it.each([
    [null, 'no answer from Pilot'],
    [{ status: 'busy' }, 'a tick was already running'],
    [{ status: 'unknown' }, 'Pilot has no such automation'],
    [{ status: 'failed', tickId: 3, error: 'glab: 401', decisions: [] }, 'failed: glab: 401'],
    [{ status: 'ok', tickId: 3, error: null, decisions: [] }, 'no items'],
    [
      {
        status: 'ok',
        tickId: 3,
        error: null,
        decisions: decisions('started', 'skipped', 'skipped', 'notdue', 'asked')
      },
      '5 items: 1 started · 1 asked you · 2 skipped · 1 not due'
    ]
  ])('%j → %s', (outcome, line) => {
    expect(dryRunLine(outcome)).toBe(line)
  })
})

describe('checkAutomations', () => {
  it('validates each file, dry-runs only the valid ones, and keeps what went wrong', () => {
    const answers: Record<string, { code: number; stdout: string; stderr: string }> = {
      'validate good.yaml': {
        code: 0,
        stdout: JSON.stringify({ ok: true, definition: { id: 'good', name: 'Good one' } }),
        stderr: ''
      },
      'dry-run good': {
        code: 0,
        stdout: JSON.stringify({
          ok: true,
          result: { status: 'ok', tickId: 1, error: null, decisions: decisions('started') }
        }),
        stderr: ''
      },
      'validate bad.yaml': {
        code: 1,
        stdout: JSON.stringify({ ok: false, errors: ['bad.yaml: unknown key "per_tic"'] }),
        stderr: ''
      },
      'validate down.yaml': {
        code: 0,
        stdout: JSON.stringify({ ok: true, definition: { id: 'down', name: 'Down' } }),
        stderr: ''
      },
      'dry-run down': { code: 1, stdout: '', stderr: "Pilot isn't running: store won't open\nmore" }
    }
    const asked: string[] = []
    const call = (args: string[]) => {
      const key =
        args[1] === 'validate' ? `validate ${args[3].split('/').pop()}` : `dry-run ${args[3]}`
      asked.push(key)
      return answers[key]
    }
    const rows = checkAutomations({ files: ['/a/good.yaml', '/a/bad.yaml', '/a/down.yaml'], call })
    expect(
      rows.map((r: { id: string; valid: boolean; dryRun: string; problems: string[] }) => [
        r.id,
        r.valid,
        r.dryRun,
        r.problems
      ])
    ).toEqual([
      ['good', true, '1 items: 1 started', []],
      ['bad', false, 'not run (invalid)', ['bad.yaml: unknown key "per_tic"']],
      [
        'down',
        true,
        "failed: Pilot isn't running: store won't open",
        ["failed: Pilot isn't running: store won't open"]
      ]
    ])
    expect(asked).not.toContain('dry-run bad')
  })
})

describe('parityRows', () => {
  it("counts each parity file's passing and failing tests", () => {
    const report = {
      testResults: [
        {
          name: '/r/src/packages/pilot/test/parity/05/fix-failed-ci.parity.test.ts',
          assertionResults: [{ status: 'passed' }, { status: 'passed' }]
        },
        {
          name: '/r/src/packages/pilot/test/parity/06/feedback.parity.test.ts',
          assertionResults: [{ status: 'passed' }, { status: 'failed' }]
        }
      ]
    }
    expect(parityRows(report)).toEqual([
      { file: '05/fix-failed-ci.parity.test.ts', passed: 2, failed: 0 },
      { file: '06/feedback.parity.test.ts', passed: 1, failed: 1 }
    ])
    expect(parityRows(null)).toEqual([])
  })
})

describe('renderSummary', () => {
  const rows = [
    {
      id: 'good',
      file: '/a/good.yaml',
      name: 'Good one',
      valid: true,
      problems: [],
      dryRun: '1 items: 1 started'
    },
    {
      id: 'bad',
      file: '/a/bad.yaml',
      name: 'bad',
      valid: false,
      problems: ['unknown key "per_tic"'],
      dryRun: 'not run (invalid)'
    }
  ]

  it('heads the section with the time and how many are ready, then the tables, problems and the go-live list', () => {
    const md = renderSummary({
      stamp: '2026-10-20 14:05',
      sha: 'abc1234',
      rows,
      parity: [{ file: '06/feedback.parity.test.ts', passed: 1, failed: 1 }]
    })
    expect(md.split('\n')[0]).toBe(
      '## 2026-10-20 14:05 Go-live readiness check · 1 of 2 automations ready'
    )
    expect(md).toContain('| Good one | `good.yaml` | yes | 1 items: 1 started |')
    expect(md).toContain('Parity tests: 1 file, 1 failing.')
    expect(md).toContain('- bad: unknown key "per_tic"')
    expect(md).toContain('- parity 06/feedback.parity.test.ts: 1 failing')
    expect(md).toContain('**Before you switch them on (Task 50)**')
  })

  it('says None when nothing is wrong', () => {
    const md = renderSummary({
      stamp: 's',
      sha: 'x',
      rows: [rows[0]],
      parity: [{ file: 'a', passed: 3, failed: 0 }]
    })
    expect(md).toContain('Parity tests: 1 file, all passing.')
    expect(md).toContain('**Problems**\n- None.')
  })
})

describe('assertScratch', () => {
  it("refuses the packaged app's own data folder, in any spelling", () => {
    expect(() =>
      assertScratch('/h/Library/Application Support/Pilot/', '/h/Library/Application Support/Pilot')
    ).toThrow(/scratch copy/)
    expect(() =>
      assertScratch(
        '/h/Library/Application Support/pilot-golive',
        '/h/Library/Application Support/Pilot'
      )
    ).not.toThrow()
  })
})

describe('agentCommands', () => {
  const YOLO = {
    claude: 'claude --dangerously-skip-permissions',
    codex: 'codex --dangerously-bypass-approvals-and-sandbox'
  }
  it.each([
    [
      "Settings' own args",
      {
        agentDefaultArgs: {
          claude: '--dangerously-skip-permissions',
          codex: '--dangerously-bypass-approvals-and-sandbox'
        }
      },
      YOLO
    ],
    [
      'a command override and empty args',
      {
        agentCmdOverrides: { codex: 'codex --profile work' },
        agentDefaultArgs: { claude: '', codex: '' }
      },
      { claude: 'claude', codex: 'codex --profile work' }
    ],
    ["no Settings: upstream's defaults", null, YOLO]
  ])('%s', (_name, settings, expected) => {
    expect(agentCommands(settings)).toEqual(expected)
  })
})

describe('repeatedAgentFlags', () => {
  it("names each step whose args repeat an option of its agent's command; Codex's -c may repeat", () => {
    const definition = {
      steps: [
        {
          name: 'test',
          agent: 'codex',
          args: [
            '-c',
            'check_for_update_on_startup=false',
            '--dangerously-bypass-approvals-and-sandbox'
          ]
        },
        { name: 'fix', agent: 'claude', args: ['--permission-mode', 'acceptEdits'] },
        { name: 'stack', agent: 'shell', args: [] }
      ]
    }
    const commands = {
      claude: 'claude --dangerously-skip-permissions',
      codex: "codex -c model=x '--dangerously-bypass-approvals-and-sandbox'"
    }
    expect(repeatedAgentFlags(definition, commands)).toEqual([
      "step test repeats --dangerously-bypass-approvals-and-sandbox, which Pilot's codex command already has (codex -c model=x '--dangerously-bypass-approvals-and-sandbox'): the agent may refuse to start"
    ])
  })

  it('makes the automation not ready, while its dry run still runs', () => {
    const definition = {
      id: 'qa',
      name: 'QA',
      steps: [{ name: 'test', agent: 'codex', args: ['--yolo'] }]
    }
    const call = (args: string[]) =>
      args[1] === 'validate'
        ? { code: 0, stdout: JSON.stringify({ ok: true, definition }), stderr: '' }
        : {
            code: 0,
            stdout: JSON.stringify({
              ok: true,
              result: { status: 'ok', tickId: 1, error: null, decisions: [] }
            }),
            stderr: ''
          }
    const [row] = checkAutomations({
      files: ['/a/qa.yaml'],
      call,
      commands: { codex: 'codex --yolo' }
    })
    expect([row.dryRun, row.problems]).toEqual([
      'no items',
      [
        "step test repeats --yolo, which Pilot's codex command already has (codex --yolo): the agent may refuse to start"
      ]
    ])
  })
})

describe('settingsFromData', () => {
  it("reads the scratch profile's Settings, or null when it has none", () => {
    const data = mkdtempSync(join(tmpdir(), 'pilot-golive-settings-'))
    expect(settingsFromData(data)).toBeNull()
    mkdirSync(join(data, 'profiles', 'local-default'), { recursive: true })
    writeFileSync(
      join(data, 'profiles', 'local-default', 'orca-data.json'),
      JSON.stringify({ settings: { agentDefaultArgs: { codex: '--x' } } })
    )
    expect(settingsFromData(data)).toEqual({ agentDefaultArgs: { codex: '--x' } })
  })
})
