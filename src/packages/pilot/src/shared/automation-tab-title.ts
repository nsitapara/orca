// An automation's tab says so in its name. Pilot launches it with this name, which becomes the tab's
// customTitle: the Activity card, the tab bar, the palette and mobile all show customTitle first,
// and the renderer gives such a tab the automation icon. A user rename drops both.
const AUTOMATION_TAB_PREFIX = '[Automation] '

export function automationTabTitle(title: string): string {
  return isAutomationTabTitle(title) ? title : `${AUTOMATION_TAB_PREFIX}${title}`
}

export function isAutomationTabTitle(title: string | null | undefined): boolean {
  return title?.startsWith(AUTOMATION_TAB_PREFIX) === true
}
