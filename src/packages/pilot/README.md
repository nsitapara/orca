# Pilot

Pilot is Nish's fork of Orca (`github.com/nsitapara/orca`), with Automations rebuilt: automations that check each MR, worktree or ticket, a Waiting on you inbox, timelines and agent actions. The spec and decision log are in the Obsidian vault: `Agent Work/Automation platform - Spec.md` and `Agent Work/Automation platform.md`.

- **The drop-in rule:** everything Pilot adds lives in this folder. Upstream files only gain the hooks listed in `HOOKS.md`.
- **Update from upstream:** `node src/packages/pilot/scripts/update.mjs` (see the script's `--help`).
- **Dev:** `node src/packages/pilot/scripts/dev.mjs` runs `pnpm dev` with a separate `pilot-dev` data folder.
- **Build for macOS:** `node src/packages/pilot/scripts/build-mac.mjs`.
  - Swift 6.4 (Xcode 27) workaround: the Swift helper steps run with `scripts/shims/swift` first on PATH, which adds `--build-system native` to `swift build` because Orca's helper scripts expect the `.build/<triple>/release` layout. Drop the shim once upstream's scripts handle the swiftbuild layout, or when `native` is removed from SwiftPM.
  - Data folder: the packaged app uses `~/Library/Application Support/Pilot` (from productName), and `bin/pilot` points at that exact path. It is separate from Orca's `orca` folder.
- **Launchers:** `bin/orca` inside Pilot launches Pilot's binary but, without `ORCA_USER_DATA_PATH`, talks to whichever app's data the environment points at. Use `pilot` for Pilot.
- **Tests:** `pnpm exec vitest run --config config/vitest.config.ts src/packages/pilot`

## Import your Orca settings

Quit Pilot, then:

    node src/packages/pilot/scripts/import-orca-settings.mjs            # dry run: shows what would change
    node src/packages/pilot/scripts/import-orca-settings.mjs --apply    # stage it; Pilot loads it on next start
    node src/packages/pilot/scripts/import-orca-settings.mjs --restore <stamp>   # undo an --apply

- **What comes over:** settings, repos, projects and their host setups, project groups, folder workspaces, sparse presets, SSH targets, worktree metadata, lineage and identities, retired worktree names, and onboarding. Each one replaces Pilot's copy.
- **What never comes over:** Orca's automations and their runs (Orca's would run in Pilot too and launch agents twice), UI state, workspace sessions, terminals and PTY leases, mobile tab selections, and telemetry.
- **Settings kept at Pilot's value:** the telemetry install id, `machineName`, custom pairing addresses (they can carry Orca's port), secrets sealed with Orca's keychain key (`opencodeSessionCookie`, `opencodeGoApiKey`, `httpProxyUrl`), managed Claude/Codex accounts (they point into Orca's data folder), and any setting whose value points into Orca's data folder. The dry run lists each one with its reason.
- **How it works:** the script reads Orca's `profile-state.db` read-only, merges the whitelist over Pilot's current state, renames Pilot's `profile-state.db*`, `.authority` marker, backups and exports aside with a `.pre-orca-import-<stamp>` suffix, and writes `orca-data.json` in Pilot's profile. On its next start, Pilot's own legacy-JSON migration imports it into a fresh `profile-state.db`. Nothing is deleted, and nothing in Orca's data folder is written.
- **Re-sync:** run `--apply` again at any time. Pilot's own UI, sessions and automations are kept, and the whitelisted parts are refreshed from Orca.
- It refuses to run while Pilot is running (a `Pilot.app/Contents/MacOS/Pilot` process, or `SingletonLock` / `orcad.lock` in Pilot's data folder).

## Remote use (D25)

Pilot keeps Orca's pairing, WebSocket server, web client and `orcad` protocols unchanged. Pilot's runtime listens on 6868 (override `PILOT_WS_PORT`), so it runs beside real Orca on 6768. Pairing links stay `orca://pair?code=...` and carry Pilot's endpoint.

### Verified 2026-10-10 (automated)

- **Pilot and Orca side by side: pass.** Run from `dist/mac-arm64/Pilot.app` (rebuilt that day), with real Orca running:

      Orca   25130 ... TCP *:6768 (LISTEN)
      Pilot  83991 ... TCP 127.0.0.1:6868 (LISTEN)

  Pilot has not paired a device, so its WebSocket listener is bound to loopback only (upstream behaviour, STA-2370).

- **Headless `orcad`: pass.** `pnpm run build:orcad` writes `out/orcad/orcad.js`. Started with `ORCA_USER_DATA=<temp dir> node out/orcad/orcad.js --port 6790` (a temp data folder, never Orca's), it printed `[pilot] attached (orcad)` and `Bound endpoint: ws://127.0.0.1:6790`, and a pairing URL. Then, with the packaged Pilot CLI:

      pilot environment add --name local-orcad --pairing-code <code>
      pilot automations status --environment local-orcad
      -> Pilot 0.1.0 (orcad)

  The flag is `--environment <id or name>`; this CLI has no `--host`. The environment was removed afterwards (`pilot environment rm --environment local-orcad`).

### Pending, Nish to verify (2026-10-10)

These need a phone, a second Mac and an iPad on Tailscale. Open Pilot (`dist/mac-arm64/Pilot.app`) first. Do not use real Orca's `orca` CLI for these: it would save the environment in Orca's data.

- [ ] **Phone.** In Pilot, open the "Orca Mobile" nav entry (the name stays). Scan the QR code with the Orca mobile app on a phone that is on Tailscale. Expect Pilot's worktrees listed and a terminal that opens. The link is `orca://pair?code=...` and its endpoint is this Mac's address on port 6868.
- [ ] **Another Mac.** On a second Mac with Orca installed, run `orca environment add --name pilot-mac --pairing-code <code from Pilot's pairing screen>`, then `orca worktree list --host runtime:<environment id>` (if `--host` is rejected, use `--environment <id>`). Expect Pilot's worktrees.
- [ ] **Browser web client.** Open Pilot's web client URL (from the same pairing screen, pairing in the URL fragment) on an iPad or another machine, using this Mac's Tailscale address on port 6868. Expect the full UI, with **Automations** showing Pilot's page.
- Pilot's WebSocket listener binds loopback until a device is paired (upstream STA-2370), so the network bind appears only after the first pairing. If a Tailscale address refuses the connection before pairing, that is expected.

## Known gaps

- Computer Use is unavailable in packaged Pilot. Enabling it needs a Pilot bundle id for the helper plus a trust-list entry in its Swift peer check.
- After closing the right sidebar while on the Automations tab, Orca's main-side persistence allowlist resets the stored tab to Explorer (the UI hydrates it back via `hydratePersistedUI`), so reopening or restarting lands on Explorer, not Automations.
- After a restart (or closing and reopening the right sidebar) the sidebar tab comes back as Explorer, because main's persistence allowlist drops `plugin:pilot`. The existing sidebar-tab note above covers the same cause.
- "Install CLI" installs `/usr/local/bin/pilot`, not `orca`. Checked in code, not clicked: `applyPilotEnvDefaults` (`src/main/env.ts`) sets `ORCA_CLI_INSTALL_PATH` to `/usr/local/bin/pilot`, and `cli-install-location.ts` uses that override ahead of its own `orca` default.
- Packaged builds are unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`, `--dir` output). macOS may ask you to allow the app on first launch.

## Updating from upstream

    node src/packages/pilot/scripts/update.mjs            # sync + verify
    node src/packages/pilot/scripts/update.mjs --build    # …and build Pilot.app
    node src/packages/pilot/scripts/update.mjs --dry-run  # show the steps only

`main` is always an exact copy of `upstream/main`. GitHub's "Sync fork" button does the same fast-forward. `pilot` merges `main`. Pilot's code is all in this folder, so a merge conflict can only be in one of the hook lines in `HOOKS.md`. Fix that line, commit, and run the command again. Pushing is opt-in (`--push`). The command refuses to start with uncommitted changes to tracked files.
