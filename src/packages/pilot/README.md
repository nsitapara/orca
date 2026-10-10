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

## Known gaps

- Computer Use is unavailable in packaged Pilot. Enabling it needs a Pilot bundle id for the helper plus a trust-list entry in its Swift peer check.
- After closing the right sidebar while on the Automations tab, Orca's main-side persistence allowlist resets the stored tab to Explorer (the UI hydrates it back via `hydratePersistedUI`), so reopening or restarting lands on Explorer, not Automations.

## Updating from upstream

    node src/packages/pilot/scripts/update.mjs            # sync + verify
    node src/packages/pilot/scripts/update.mjs --build    # …and build Pilot.app
    node src/packages/pilot/scripts/update.mjs --dry-run  # show the steps only

`main` is always an exact copy of `upstream/main`. GitHub's "Sync fork" button does the same fast-forward. `pilot` merges `main`. Pilot's code is all in this folder, so a merge conflict can only be in one of the hook lines in `HOOKS.md`. Fix that line, commit, and run the command again. Pushing is opt-in (`--push`). The command refuses to start with uncommitted changes to tracked files.
