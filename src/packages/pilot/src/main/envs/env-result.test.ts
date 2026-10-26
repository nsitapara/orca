import { describe, expect, it } from 'vitest'
import { parseEnvResult, parseEnvRows } from './env-result'

const base = {
  run: 'r1',
  mode: 'throwaway',
  reason: 'needs its own stack',
  path: '/agents/r/agents-r1',
  branch: null,
  sha: 'abc',
  env_file: '/s/env.sh',
  delete: 'pilotcli env delete r1'
}

describe('parseEnvResult', () => {
  it('reads a throwaway with a backend stack', () => {
    const result = parseEnvResult({
      ...base,
      stack: {
        kind: 'backend',
        project: 'agents-r1',
        urls: { api: 'http://localhost:8123', staff: null },
        ports: {},
        log: '/s/stack.log'
      },
      env: { COMPOSE_PROJECT_NAME: 'agents-r1', API_URL: 'http://localhost:8123' }
    })
    expect(result).toEqual({
      mode: 'throwaway',
      reason: 'needs its own stack',
      path: '/agents/r/agents-r1',
      sha: 'abc',
      envFile: '/s/env.sh',
      vars: { COMPOSE_PROJECT_NAME: 'agents-r1', API_URL: 'http://localhost:8123' },
      stack: {
        kind: 'backend',
        project: 'agents-r1',
        urls: { api: 'http://localhost:8123' },
        log: '/s/stack.log'
      }
    })
  })

  it('reads in place, with no stack and no env', () => {
    expect(
      parseEnvResult({ ...base, mode: 'in_place', path: '/wt/a', stack: null, env: {} })
    ).toMatchObject({ mode: 'in_place', vars: {}, stack: null })
  })

  it.each([
    ['PILOT_RUN_ID', { PILOT_RUN_ID: 'x' }, 'PILOT_RUN_ID is reserved'],
    ['ORCA_USER_DATA_PATH', { ORCA_USER_DATA_PATH: 'x' }, 'ORCA_USER_DATA_PATH is reserved'],
    ['PATH', { PATH: '/x' }, 'PATH is reserved'],
    ['a lower-case name', { api_url: 'x' }, "api_url isn't a usable name"]
  ])('refuses the variable %s', (_name, env, problem) => {
    expect(() => parseEnvResult({ ...base, env })).toThrow(
      `pilotcli env create returned a variable Pilot won't pass to steps: ${problem}`
    )
  })

  it.each([
    ['a number for a value', { ...base, env: { API_PORT: 8123 } }],
    ['a relative path', { ...base, path: 'agents-r1' }],
    ['an unknown mode', { ...base, mode: 'shared' }],
    ['no path', { run: 'r1', mode: 'in_place', reason: '' }]
  ])('refuses %s', (_name, data) => {
    expect(() => parseEnvResult(data)).toThrow(
      "pilotcli env create's result doesn't fit the contract"
    )
  })
})

describe('parseEnvRows', () => {
  const row = (over: Record<string, unknown>) => ({
    run: 'Fix_CI-1',
    name: 'agents-fix-ci-1',
    project: 'agents-fix-ci-1',
    mode: 'throwaway',
    status: 'ready',
    path: '/a',
    stack: null,
    created: '2026-10-13T10:00:00Z',
    age_hours: 1.5,
    orphan: false,
    stale: false,
    ...over
  })
  it('reads the contract rows: run exactly as given, the status, orphans with an empty run, the owning run', () => {
    const made = Date.parse('2026-10-13T10:00:00Z')
    expect(
      parseEnvRows([
        row({}),
        row({ run: '', name: 'agents-old', path: '/b', mode: '', created: null, orphan: true }),
        row({ run: 'r2-draft', status: 'creating', path: null, owner_run: 'r2' })
      ])
    ).toEqual([
      {
        run: 'Fix_CI-1',
        mode: 'throwaway',
        status: 'ready',
        path: '/a',
        created: made,
        orphan: false,
        ownerRun: ''
      },
      { run: '', mode: '', status: 'ready', path: '/b', created: null, orphan: true, ownerRun: '' },
      {
        run: 'r2-draft',
        mode: 'throwaway',
        status: 'creating',
        path: null,
        created: made,
        orphan: false,
        ownerRun: 'r2'
      }
    ])
  })
  it('refuses anything but a list of rows', () => {
    expect(() => parseEnvRows({ envs: [] })).toThrow(
      "pilotcli env list didn't return a list of envs"
    )
  })
})
