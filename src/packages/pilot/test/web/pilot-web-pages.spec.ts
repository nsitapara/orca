import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium, expect, test, type Browser, type Page } from '@stablyai/playwright-test'
import {
  launchHeadlessPairedRuntimeHost,
  type HeadlessPairedRuntimeHost
} from '../../../../../tests/e2e/helpers/headless-paired-runtime-host'

const PROBE_YAML =
  'name: Web probe\nrepo: r\nschedule: manual\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\ninbox: nish\n'
const PEOPLE_YAML = 'people:\n  - { id: nish, name: Nish }\n'
const PROBE_TITLE = 'Browser check: is the Inbox reachable?'

test.describe.configure({ mode: 'serial' })

let host: HeadlessPairedRuntimeHost | undefined
let browser: Browser | undefined
let page: Page
let automations: string | undefined
const problems: string[] = []

test.beforeAll(async () => {
  // The server reads its automations folder at startup, so it must exist first.
  automations = mkdtempSync(path.join(os.tmpdir(), 'pilot-web-automations-'))
  writeFileSync(path.join(automations, 'web-probe.yaml'), PROBE_YAML)
  writeFileSync(path.join(automations, 'people.yaml'), PEOPLE_YAML)
  Object.assign(process.env, {
    PILOT_AUTOMATION_DIRS: automations,
    PILOT_SCHEDULER: 'off',
    PILOT_VAULT_EXPORT: 'off',
    ORCA_CLI_INSTALL_PATH: path.join(automations, 'cli', 'pilot'),
    ORCA_BROWSER_EXECUTABLE: '',
    ORCA_BACKGROUND_LAUNCH: '1',
    // The Playground's Telemetry tab reads through pilotcli: a missing one keeps Nish's real pilotcli (and its
    // telemetry file) out of the check.
    PILOT_PILOTCLI: path.join(automations, 'no-pilotcli')
  })
  host = await launchHeadlessPairedRuntimeHost()
  await host.client.call('pilot.inbox.add', {
    automationId: 'web-probe',
    itemKey: 'probe-1',
    type: 'question',
    title: PROBE_TITLE,
    detailsMd: 'Seeded by the browser check.'
  })
  if (!host.offer.webClientUrl) {
    throw new Error('The server offered no web client: run pnpm run build:web first')
  }
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (e) => problems.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().includes('[pilot]')) {
      problems.push(m.text())
    }
  })
  // A runtime-scope #pairing= link saves the offer itself, so no connect screen shows.
  await page.goto(host.offer.webClientUrl)
})

test.afterEach(() => expect(problems).toEqual([]))

test.afterAll(async () => {
  await browser?.close()
  await host?.dispose()
  if (automations) {
    rmSync(automations, { recursive: true, force: true })
  }
})

test("Inbox lists the server's card", async () => {
  await expect(page).toHaveTitle('Pilot Web')
  const inbox = page.getByRole('button', { name: /^Inbox/ })
  await expect(inbox).toBeVisible({ timeout: 60_000 })
  await expect(inbox).toContainText('1')
  const heading = page.getByRole('heading', { name: 'Inbox', exact: true })
  // Startup's UI restore puts back the saved view, undoing a click that lands before it.
  await expect(async () => {
    await inbox.click()
    await expect(heading).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
  // The card shows twice: its row in the list, and the open card beside it.
  await expect(page.getByRole('button').filter({ hasText: PROBE_TITLE })).toBeVisible()
  await expect(page.getByRole('heading', { name: PROBE_TITLE, exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('inbox.png') })
})

test("Running shows the server's run limit", async () => {
  await page.getByRole('button', { name: 'Running', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Run limit' })).toBeVisible()
  await expect(page.getByText('Nothing is running.')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('running.png') })
})

test("Automations lists the server's automation and flips it as a paired device", async () => {
  // The right sidebar's activity bar has an Automations icon too.
  const automations = page
    .locator('[data-contextual-tour-target="sidebar-navigation"]')
    .getByRole('button', { name: 'Automations', exact: true })
  const toggle = page.getByRole('switch', { name: /^Web probe: turn (on|off)$/ })
  // Startup's UI restore puts back the saved view, undoing a click that lands before it.
  await expect(async () => {
    await automations.click()
    await expect(toggle).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
  const before = await toggle.getAttribute('aria-checked')
  await toggle.click()
  await expect(toggle).not.toHaveAttribute('aria-checked', before ?? '')
})

test('Playground opens on Telemetry, and its Commands tab says it runs where Pilot runs', async () => {
  await page.getByRole('button', { name: 'Playground', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Telemetry', selected: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Commands' }).click()
  await expect(page.getByText(/runs only on the machine Pilot runs on/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start' })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('playground.png') })
})
