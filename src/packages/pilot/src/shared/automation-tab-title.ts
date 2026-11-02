import { jobCode } from './job-name'

// An automation's tab says so in its name. Pilot launches it with this name, which becomes the tab's
// customTitle: the Activity card, the tab bar, the palette and mobile all show customTitle first,
// and the renderer gives such a tab the automation icon. A user rename drops both.
// A manual job's tab ("M01 · …") is the user's own work, so it keeps a plain name and its agent's icon,
// and so does a session handed over at its start (a wait: start step), whatever the job.
const AUTOMATION_TAB_PREFIX = '[Automation] '

export function automationTabTitle(
  title: string,
  { handedOver = false }: { handedOver?: boolean } = {}
): string {
  if (handedOver || isAutomationTabTitle(title) || jobCode(title)?.startsWith('M')) {
    return title
  }
  return `${AUTOMATION_TAB_PREFIX}${title}`
}

export function isAutomationTabTitle(title: string | null | undefined): boolean {
  return title?.startsWith(AUTOMATION_TAB_PREFIX) === true
}
