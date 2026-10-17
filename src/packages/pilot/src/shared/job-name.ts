// The job code at the front of a vault job name: "05 · Fix failed CI on my MRs" → "05", "M01 · …" → "M01".
const CODE = /^(M?\d{2}) · /

export function jobCode(jobName: string): string | null {
  return CODE.exec(jobName)?.[1] ?? null
}

// The vault job an automation belongs to (F6/G9): its `name` already starts with a code (it is that job),
// else the vault job whose name after "<code> · " equals the automation's name, else none (a Pilot-only
// job, which callers key by the automation id).
export function vaultJobName(automationName: string, jobNames: readonly string[]): string | null {
  if (jobCode(automationName)) {
    return automationName
  }
  return (
    jobNames.find((job) => jobCode(job) !== null && job.replace(CODE, '') === automationName) ??
    null
  )
}
