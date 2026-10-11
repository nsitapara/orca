# Pilot

Pilot is Nish's fork of Orca (`github.com/nsitapara/orca`), with Automations rebuilt: automations that check each MR, worktree or ticket, a Waiting on you inbox, timelines and agent actions. The spec and decision log are in the Obsidian vault: `Agent Work/Automation platform - Spec.md` and `Agent Work/Automation platform.md`.

- **The drop-in rule:** everything Pilot adds lives in this folder. Upstream files only gain the hooks listed in `HOOKS.md`.
- **Update from upstream:** `node src/packages/pilot/scripts/update.mjs` (see the script's `--help`).
- **Dev:** `node src/packages/pilot/scripts/dev.mjs` runs `pnpm dev` with a separate `pilot-dev` data folder, its own automations folder (`pilot-dev/automations`) and the scheduler off. Set `PILOT_AUTOMATION_DIRS` or `PILOT_SCHEDULER` yourself to override either.
- **Scheduler:** only one Pilot ticks automations, because each data folder has its own `handled` table. With `PILOT_SCHEDULER` unset, only the packaged desktop app ticks; dev, `--serve` and orcad don't. `PILOT_SCHEDULER=on` turns it on in any of them, and `off` turns it off everywhere.
- **Build for macOS:** `node src/packages/pilot/scripts/build-mac.mjs`.
  - Swift 6.4 (Xcode 27) workaround: the Swift helper steps run with `scripts/shims/swift` first on PATH, which adds `--build-system native` to `swift build` because Orca's helper scripts expect the `.build/<triple>/release` layout. Drop the shim once upstream's scripts handle the swiftbuild layout, or when `native` is removed from SwiftPM.
  - Data folder: the packaged app uses `~/Library/Application Support/Pilot` (from productName), and both launchers point at that exact path. It is separate from Orca's `orca` folder.
- **Launchers:** Pilot ships two identical launchers, `bin/orca` and `bin/pilot`. Both export Pilot's data folder (`ORCA_USER_DATA_PATH`) and CLI install path (`ORCA_CLI_INSTALL_PATH=/usr/local/bin/pilot`), so neither acts on real Orca, even when run from an Orca terminal.
- **Tests:** `pnpm exec vitest run --config config/vitest.config.ts src/packages/pilot`

## Import your Orca settings

Quit Pilot, then:

    node src/packages/pilot/scripts/import-orca-settings.mjs            # dry run: shows what would change
    node src/packages/pilot/scripts/import-orca-settings.mjs --apply    # stage it; Pilot loads it on next start
    node src/packages/pilot/scripts/import-orca-settings.mjs --restore <stamp>   # undo an --apply
    node src/packages/pilot/scripts/import-orca-settings.mjs --list     # backup sets (works while Pilot runs)

- **What comes over:** settings, repos, projects and their host setups, project groups, folder workspaces, sparse presets, SSH targets, worktree metadata, lineage and identities, retired worktree names, and onboarding. Each one replaces Pilot's copy.
- **What never comes over:** Orca's automations and their runs (Orca's would run in Pilot too and launch agents twice), UI state, workspace sessions, terminals and PTY leases, mobile tab selections, and telemetry.
- **Settings kept at Pilot's value:** the telemetry install id, `machineName`, custom pairing addresses (they can carry Orca's port), secrets sealed with Orca's keychain key (`opencodeSessionCookie`, `opencodeGoApiKey`, `httpProxyUrl`), managed Claude/Codex accounts (they point into Orca's data folder), and any setting whose value points into Orca's data folder. The dry run lists each one with its reason.
- **How it works:** the script copies Orca's `profile-state.db` and its WAL to a temp folder and reads the copy (it never opens Orca's files, so even Orca's `-shm` is untouched), merges the whitelist over Pilot's current state, renames Pilot's `profile-state.db*`, `.authority` marker, backups and exports aside with a `.pre-orca-import-<stamp>` suffix, and writes `orca-data.json` in Pilot's profile. On its next start, Pilot's own legacy-JSON migration imports it into a fresh `profile-state.db`. Nothing is deleted, and nothing in Orca's data folder is written.
- **Re-sync:** run `--apply` again at any time. Pilot's own UI, sessions and automations are kept, and the whitelisted parts are refreshed from Orca.
- It refuses to run while Pilot is running (a `Pilot.app/Contents/MacOS/Pilot` process, or `SingletonLock` / `orcad.lock` in Pilot's data folder).
- It refuses, changing nothing, when Orca's database isn't the layout it was written for: a profile-state schema other than 3, a `domain_version` other than 1, or a whitelisted domain that is missing, `null` or the wrong JSON type (what upstream leaves behind when it moves a domain into its own table). Update the script from upstream's `src/main/persistence/profile-state/` code first.
- **Pruning backups:** nothing deletes them. `--list` shows each set by stamp. Once Pilot has started cleanly on a newer import, delete an old set by hand, e.g. `rm ~/Library/Application\ Support/Pilot/profiles/local-default/*.pre-orca-import-<stamp>`. Keep the newest set until you're sure you won't need `--restore`.

## Migrating an automation

How one of the old sweeps that real Orca schedules (`~/.agents/skills/<name>-sweep`) moves onto Pilot. Automation 05, "Fix failed CI on my MRs" (`ci-fix-sweep` → `fix-failed-ci`), went first. `pilot` below is `dist/mac-arm64/Pilot.app/Contents/Resources/bin/pilot`.

1. **Write the YAML.**
   - One file per automation in `~/.agents/automations/`. The file name is its id.
   - Pilot reads the folder through a link: `mkdir -p ~/.pilot && ln -sfn ~/.agents/automations ~/.pilot/automations`.
   - Start with `schedule: manual`, so it can't run on its own while it shadows the old sweep.
   - People named in `author:` come from `people.yaml` in the same folder.
   - Commit both files in `~/.agents` through a temporary index, because other sessions commit there too.
2. **Validate.**
   - Run `pilot automations validate --file <file>`. It prints `ok <id>` and exits 0, or prints each problem and exits 1.
   - Parsing is strict: unknown keys fail, and so do features from later milestones.
   - The command checks automation files only. `people.yaml` problems show in `pilot automations status`.
   - Pilot doesn't watch a folder that was created after it started. Until there's a `reload` command, re-scan with the CLI's own client, or restart Pilot:

         C="$PWD/dist/mac-arm64/Pilot.app/Contents"    # from the repo root; require() needs an absolute path
         ORCA_USER_DATA_PATH="$HOME/Library/Application Support/Pilot" ELECTRON_RUN_AS_NODE=1 "$C/MacOS/Pilot" \
           -e 'new (require(process.argv[1]).RuntimeClient)().call("pilot.automations.reload").then((r) => console.log(JSON.stringify(r.result, null, 2)))' \
           "$C/Resources/app.asar.unpacked/out/cli/runtime/client.js"

     The output lists the automations, with any definition or people errors. `pilot automations status` should show no folder marked "(missing)". A reload re-scans the folder but doesn't start watching it, so later edits need another reload, until Pilot restarts with the folder already in place.
3. **Dry-run beside the old sweep.**
   - Run `pilot automations dry-run --id <id>`. It checks every item and records a dry tick in Activity. Nothing starts.
   - Compare each item with the old sweep's latest tick in its `sweep.log`:
     - old **due** ↔ **started**;
     - old **skip** ↔ **skipped**, **not due** or **not in scope**, with the same reason in substance.
   - Never run `pilot automations tick` or Run now while shadowing.
   - The old sweeps' `--dry-run` isn't read-only: it records decision events and refreshes `mr-cache.json`. Compare against `sweep.log`, or against the inputs the sweep reads, gathered by hand.
4. **Seed `handled`.** So Pilot doesn't retry what the old sweep already tried:

       node src/packages/pilot/scripts/seed-handled-from-sweep.mjs            # dry run: counts only
       node src/packages/pilot/scripts/seed-handled-from-sweep.mjs --apply    # insert the missing keys

   - It maps 05's `handled.json` (`"<iid>": <pipeline id>`) to `<iid>:<pipeline>` keys for `fix-failed-ci`, with `run_id` null.
   - It only adds keys, never replaces one, and is safe to re-run while Pilot runs.
   - It refuses when Pilot's database or `main/store/migrations.ts` isn't at the schema it was written for.
   - Other sweeps keep different state, so each needs its own mapping.
5. **Shadow.**
   - Keep `schedule: manual`.
   - Across a working day, run the dry run just after a few of the old sweep's ticks (05 ticks at :10 each hour). Compare each run with `sweep.log`.
   - Record every comparison in the vault note (`Agent Work/Automation platform.md`). A difference that isn't just wording is a Pilot bug to fix before cutover.
6. **Cut over (Nish approves).**
   1. Re-seed `handled` right before switching (`--apply` again), because the old sweep keeps adding entries until it's off.
   2. Confirm no CI-fix tabs are open in real Orca before disabling 05. Pilot's session check sees only its own terminals, so it wouldn't hold back a worktree where an old sweep's agent is still open.
   3. Disable the old automation in real Orca.
   4. Set the schedule in the YAML (05: `"10 * * * *"`) and commit it in `~/.agents`. Validate the YAML before saving a schedule change (`pilot automations validate --file <file>`): an invalid file drops the automation until it's fixed.
   5. Make sure Pilot has the edit: the Automations list shows the new schedule, and so does the reload above (its `schedule` and `nextTickAt`). Expect the first real tick at the **next** slot, not at once: a schedule set while Pilot runs is walked from now (Task 20's catch-up rule).
      - If Pilot is restarted instead, an automation with no real tick yet walks from an hour before the start. A slot that fell in that hour then runs once, right at start.

### Automation 05 (`fix-failed-ci`)

- [x] 1–2, 2026-10-10: YAML and people written, validated and linked; one key seeded (`1587:2933991087`). The dry run agreed with the old sweep on all 7 of Nish's open MRs (all not due, head pipelines green). The 22 teammate MRs are not in scope, and the old sweep never lists them. Details are in the vault note's M1 entry.
- [ ] 3. Shadow for a working day: **pending, Nish**.
- [ ] 4. Cut over (disable Orca's 05, schedule `"10 * * * *"`): **pending, Nish**.

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
- After closing the right sidebar while on the Automations tab, Orca's main-side persistence allowlist drops `plugin:pilot` and resets the stored tab to Explorer (the UI hydrates it back via `hydratePersistedUI`), so reopening or restarting lands on Explorer, not Automations.
- "Install CLI" links `/usr/local/bin/pilot` (never `orca`) to Pilot's `Contents/Resources/bin/orca`: upstream's `bundled-cli-launcher-path.ts` always installs the `bin/orca` launcher, and `applyPilotEnvDefaults` (`src/packages/pilot/src/main/env.ts`) sets `ORCA_CLI_INSTALL_PATH` to `/usr/local/bin/pilot`, which `cli-install-location.ts` uses ahead of its own `orca` default. That launcher pins Pilot's data folder and install path, so the installed `pilot` command and `pilot serve` (which re-installs the CLI on start) act on Pilot, never on real Orca. Checked in code and by `build/bin/launchers.test.ts`, not clicked.
- Packaged builds are unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`, `--dir` output). macOS may ask you to allow the app on first launch.
- Upstream orcad keeps its own data in `~/.orca` (or `$XDG_DATA_HOME/Orca`) unless `ORCA_USER_DATA` is set, so Pilot's orcad started without it shares real Orca's headless folder. Set `ORCA_USER_DATA` when running Pilot's orcad (Task 9 does). Pilot's own store never goes there: it uses `ORCA_USER_DATA` when set, else `~/.pilot/orcad/`.

## Updating from upstream

    node src/packages/pilot/scripts/update.mjs            # sync + verify
    node src/packages/pilot/scripts/update.mjs --build    # …and build Pilot.app
    node src/packages/pilot/scripts/update.mjs --dry-run  # show the steps only

Verifying means the hook guard, the typecheck, Pilot's tests, and the upstream tests next to each hooked file in `HOOKS.md` (whole folders for startup, orcad, updater, CLI specs, app-shell and the right sidebar; otherwise the file's own `*.test.ts(x)`). `main` is always an exact copy of `upstream/main`. GitHub's "Sync fork" button does the same fast-forward. `pilot` merges `main`. Pilot's code is all in this folder, so a merge conflict can only be in one of the hook lines in `HOOKS.md`. Fix that line, commit, and run the command again. Pushing is opt-in (`--push`). The command refuses to start with uncommitted changes to tracked files.
