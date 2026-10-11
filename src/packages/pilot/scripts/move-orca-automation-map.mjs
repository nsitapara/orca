// Field mapping for move-orca-automation.mjs: Orca automation -> `pilot automations create` flags,
// the fields create can't express, and the read-back check of the Pilot copy.
// Fields the script reads and maps (or checks) one by one.
const MAPPED_FIELDS = new Set([
  'name',
  'prompt',
  'agentId',
  'extraAgentArgs',
  'precheck',
  'rrule',
  'timezone',
  'enabled',
  'workspaceMode',
  'workspaceId',
  'baseBranch',
  'reuseSession',
  'missedRunGraceMinutes',
  'missedRunPolicy',
  'runContext',
  'sourceContext',
  'executionTargetType',
  'executionTargetId'
])
// Bookkeeping Pilot sets itself on create. Listed in the plan, never a reason to refuse.
export const DERIVED_FIELDS = [
  'id',
  'projectId',
  'schedulerOwner',
  'dtstart',
  'nextRunAt',
  'lastRunAt',
  'createdAt',
  'updatedAt'
]
const DERIVED_SET = new Set(DERIVED_FIELDS)

export function shellQuote(arg) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`
}

export function formatCommand(bin, args) {
  return [bin, ...args].map(shellQuote).join(' ')
}

function workspacePath(workspaceId) {
  const at = workspaceId.indexOf('::')
  return at === -1 ? workspaceId : workspaceId.slice(at + 2)
}

export const PILOT_DEFAULT_GRACE_MINUTES = 720

// The create flag only takes a positive integer, so a source of 0, null or absent can't be passed.
export function graceIsOmitted(grace) {
  return grace === undefined || grace === null || grace === 0
}

// The path the automation acts on: its worktree when it runs in an existing one, else its repo.
export function targetPath(automation) {
  if (automation.workspaceMode === 'existing' && typeof automation.workspaceId === 'string') {
    return workspacePath(automation.workspaceId)
  }
  return automation.runContext?.path ?? null
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : ''
}

// Fields `pilot automations create` can't express for this automation, keyed by field name.
export function unmappableFields(automation) {
  const blocked = {}
  for (const key of Object.keys(automation)) {
    if (!MAPPED_FIELDS.has(key) && !DERIVED_SET.has(key)) {
      blocked[key] = `Pilot's create has no flag for "${key}"`
    }
  }
  if (automation.executionTargetType !== 'local' || automation.executionTargetId !== 'local') {
    blocked.executionTarget = `runs on ${automation.executionTargetType}:${automation.executionTargetId}, create targets local only`
  }
  const context = automation.runContext
  if (context && (context.kind !== 'workspace-run' || context.hostId !== 'local')) {
    blocked.runContext = `run context ${context.kind} on host ${context.hostId} can't be created by flags`
  }
  if (automation.missedRunPolicy !== 'run_once_within_grace') {
    blocked.missedRunPolicy = `policy ${automation.missedRunPolicy}; create only sets the grace window`
  }
  const grace = automation.missedRunGraceMinutes
  if (graceIsOmitted(grace)) {
    // Create takes positive integers only, so the copy would get Pilot's default and catch up.
    blocked.missedRunGraceMinutes = `source is ${grace}, which means Orca does no catch-up after a missed run; Pilot's create can't set that and defaults to ${PILOT_DEFAULT_GRACE_MINUTES} minutes, so the copy WOULD catch up missed runs`
  } else if (!(Number.isInteger(grace) && grace > 0)) {
    blocked.missedRunGraceMinutes = `${grace} isn't a positive integer`
  }
  const extra = Object.keys(automation.precheck ?? {}).filter(
    (key) => key !== 'command' && key !== 'timeoutSeconds'
  )
  for (const key of extra) {
    blocked[`precheck.${key}`] = `create only takes the precheck command and timeout`
  }
  return blocked
}

// The exact flag list for `pilot automations create`, plus how each Orca field maps to it.
export function mapAutomation(automation) {
  const args = [
    'automations',
    'create',
    `--name=${automation.name}`,
    `--prompt=${automation.prompt}`,
    `--trigger=${automation.rrule}`,
    `--provider=${automation.agentId}`,
    `--timezone=${automation.timezone}`
  ]
  const notes = []
  const mapped = [
    ['name', '--name'],
    ['prompt', '--prompt'],
    ['rrule', '--trigger'],
    ['agentId', '--provider'],
    ['timezone', '--timezone']
  ]
  if (trimmed(automation.extraAgentArgs) !== '') {
    args.push(`--extra-agent-args=${automation.extraAgentArgs}`)
    mapped.push(['extraAgentArgs', '--extra-agent-args'])
  }
  if (automation.precheck) {
    args.push(`--precheck=${automation.precheck.command}`)
    mapped.push(['precheck.command', '--precheck'])
    if (automation.precheck.timeoutSeconds !== undefined) {
      args.push(`--precheck-timeout=${automation.precheck.timeoutSeconds}`)
      mapped.push(['precheck.timeoutSeconds', '--precheck-timeout'])
    }
  }
  const path = targetPath(automation)
  if (automation.workspaceMode === 'existing') {
    args.push(`--workspace=path:${path}`, '--workspace-mode=existing')
    mapped.push(['workspaceId', '--workspace'], ['workspaceMode', '--workspace-mode'])
  } else {
    args.push(`--repo=path:${path}`, '--workspace-mode=new-per-run')
    mapped.push(['runContext.path', '--repo'], ['workspaceMode', '--workspace-mode'])
  }
  if (automation.baseBranch) {
    args.push(`--base-branch=${automation.baseBranch}`)
    mapped.push(['baseBranch', '--base-branch'])
  }
  if (automation.sourceContext) {
    args.push(`--source-context=${JSON.stringify(automation.sourceContext)}`)
    mapped.push(['sourceContext', '--source-context'])
  }
  args.push(automation.reuseSession ? '--reuse-session' : '--fresh-session')
  mapped.push(['reuseSession', automation.reuseSession ? '--reuse-session' : '--fresh-session'])
  if (graceIsOmitted(automation.missedRunGraceMinutes)) {
    notes.push(
      `missedRunGraceMinutes: source is ${automation.missedRunGraceMinutes}; allowed to drop, so the flag is omitted, Pilot's default (${PILOT_DEFAULT_GRACE_MINUTES}, which adds catch-up) applies, and the read-back does not check this field`
    )
  } else {
    args.push(`--missed-run-grace-minutes=${automation.missedRunGraceMinutes}`)
    mapped.push(['missedRunGraceMinutes', '--missed-run-grace-minutes'])
  }
  // Always created disabled; the order in --apply decides when it becomes enabled.
  args.push('--disabled', '--json')
  mapped.push(['enabled', '--disabled (enabled last, only after Orca is off)'])
  return { args, mapped, notes }
}

// What the read-back of the new Pilot automation must show. Returns the fields that differ.
// options.checkEnabled: also require the copy to be disabled (only right after create).
// options.ignore: fields to skip (a renamed copy).
export function verifyCopy(source, copy, { checkEnabled = true, ignore = [] } = {}) {
  const problems = []
  const check = (field, expected, actual) => {
    if (ignore.includes(field)) {
      return
    }
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      problems.push(
        `${field}: expected ${JSON.stringify(expected)}, Pilot has ${JSON.stringify(actual)}`
      )
    }
  }
  check('name', source.name, copy.name)
  check('prompt', source.prompt, copy.prompt)
  check('agentId', source.agentId, copy.agentId)
  check('rrule', source.rrule, copy.rrule)
  check('timezone', source.timezone, copy.timezone)
  check('extraAgentArgs', trimmed(source.extraAgentArgs), trimmed(copy.extraAgentArgs))
  check('precheck', source.precheck ?? null, copy.precheck ?? null)
  check('workspaceMode', source.workspaceMode, copy.workspaceMode)
  check('baseBranch', source.baseBranch ?? null, copy.baseBranch ?? null)
  check('reuseSession', Boolean(source.reuseSession), Boolean(copy.reuseSession))
  if (!graceIsOmitted(source.missedRunGraceMinutes)) {
    check('missedRunGraceMinutes', source.missedRunGraceMinutes, copy.missedRunGraceMinutes)
  }
  check('sourceContext', source.sourceContext ?? null, copy.sourceContext ?? null)
  check('runContext.path', source.runContext?.path, copy.runContext?.path)
  check('target path', targetPath(source), targetPath(copy))
  check('executionTargetType', source.executionTargetType, copy.executionTargetType)
  check('executionTargetId', source.executionTargetId, copy.executionTargetId)
  check('runContext.projectId', source.runContext?.projectId, copy.runContext?.projectId)
  check('runContext.hostId', source.runContext?.hostId, copy.runContext?.hostId)
  check(
    'runContext.projectHostSetupId',
    source.runContext?.projectHostSetupId,
    copy.runContext?.projectHostSetupId
  )
  if (checkEnabled) {
    check('enabled', false, copy.enabled === true)
  }
  return problems
}

// The fields a verified copy must keep. Not the name: a rename is allowed.
export function snapshotCopy(copy) {
  return {
    prompt: copy.prompt,
    agentId: copy.agentId,
    rrule: copy.rrule,
    timezone: copy.timezone,
    extraAgentArgs: trimmed(copy.extraAgentArgs),
    precheck: copy.precheck ?? null,
    workspaceMode: copy.workspaceMode,
    baseBranch: copy.baseBranch ?? null,
    reuseSession: Boolean(copy.reuseSession),
    missedRunGraceMinutes: copy.missedRunGraceMinutes ?? null,
    sourceContext: copy.sourceContext ?? null,
    executionTargetType: copy.executionTargetType,
    executionTargetId: copy.executionTargetId,
    targetPath: targetPath(copy),
    runContext: {
      path: copy.runContext?.path,
      projectId: copy.runContext?.projectId,
      hostId: copy.runContext?.hostId,
      projectHostSetupId: copy.runContext?.projectHostSetupId
    }
  }
}

// The snapshot fields that changed since the copy was verified.
export function snapshotDrift(snapshot, copy) {
  const now = snapshotCopy(copy)
  return Object.keys(now)
    .filter((field) => JSON.stringify(snapshot?.[field]) !== JSON.stringify(now[field]))
    .map(
      (field) =>
        `${field}: verified as ${JSON.stringify(snapshot?.[field])}, now ${JSON.stringify(now[field])}`
    )
}
