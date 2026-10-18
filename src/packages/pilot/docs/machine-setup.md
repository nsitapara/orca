# Setting up another Pilot machine

One Pilot window shows the Inbox, Running, Automations and Activity of every paired machine that runs Pilot's engine. This guide sets up three more:

- **A Mac mini** runs the packaged desktop app with `PILOT_SCHEDULER=pinned`, so it ticks only the jobs pinned to it.
- **A Debian or Ubuntu box**, most likely a headless server, runs Pilot's headless engine (orcad) as a systemd user service.
- **An Arch box** (Omarchy) runs the same headless engine. Pilot has no Linux desktop app yet (see [Linux desktop app (follow-up)](#linux-desktop-app-follow-up)).

For a tick-as-you-go version of this guide, open [`machine-setup-checklist.html`](./machine-setup-checklist.html) in a browser from a clone; GitHub shows only its source. Type your machine names at the top and every command uses them. Ticks stay in that browser.

How machines, `runs_on` and pairing behave is in the README's "Pilot across machines" section. The scripts are in `src/packages/pilot/scripts/machine-setup/`. Each one takes `--help` and `--dry-run`, and is safe to re-run. A dry run prints every command that would change the machine, runs none of them, and writes nothing.

The scripts install commands into `~/.local/bin` (`pilot`, `pilotcli`, `pnpm`'s corepack shim, and on Linux `pilot-engine` and maybe `fnm`). They put it on their own PATH, but your shell may not have it: run those commands by their full path, or add `~/.local/bin` to your PATH.

| Script                       | Runs on        | What it does                                                                                                                                    |
| ---------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `macos.sh`                   | The Mac mini   | Checks Xcode's tools and Node 24, updates the checkouts, keeps Pilot's settings in a LaunchAgent, builds and installs Pilot.app, names the Mac  |
| `debian.sh`                  | Debian, Ubuntu | apt packages, Node 24, the checkouts, then `linux-engine.sh`                                                                                    |
| `arch.sh`                    | Arch, Omarchy  | pacman packages, Node 24, the checkouts, then `linux-engine.sh`                                                                                 |
| `linux-engine.sh`            | Either Linux   | Builds orcad, installs it, writes its settings, runs it as `pilot-engine.service`, prints the pairing command. Run it alone to update an engine |
| `pilotcli-cross-build.sh`    | The main Mac   | Builds pilotcli for another machine                                                                                                             |
| `step-runner.sh`             | (sourced)      | How a step runs: printing, `--dry-run`, sudo steps, file writes, the OS check                                                                   |
| `checkouts-and-toolchain.sh` | (sourced)      | The shared flags, the checkouts (Pilot, `~/.agents`, pilotcli), pnpm and Go                                                                     |

## Before you start

On the main Mac:

1. **Pilot is installed**, and the `pilot` CLI is at `~/.local/bin/pilot` (`build-mac.mjs` links it).
2. **Tailscale is on**, on every machine, in the same tailnet. The scripts don't install it.
3. **pilotcli comes from its private repo, `nsitapara/pilotCLI`.** Pass `--pilotcli-repo https://github.com/nsitapara/pilotCLI.git` to each setup script. It clones or fast-forwards `~/Documents/GitHub/pilotCLI` on `main` and puts a Go new enough for its `go.mod` on PATH. If none is installed, it downloads one, checks its checksum and keeps it under `~/.local/share/pilot-setup`. Then it runs pilotCLI's own `scripts/install.sh`, which builds only a clean, tested `main`.

   For a machine without git access to it, cross-build pilotcli here, copy it over, and pass `--pilotcli-binary <file>` instead:

       src/packages/pilot/scripts/machine-setup/pilotcli-cross-build.sh --target linux/amd64 --target darwin/arm64
       scp ~/Documents/GitHub/pilotCLI/bin/pilotcli-linux-amd64 debian-box:~/

   The builds land in `~/Documents/GitHub/pilotCLI/bin/` (gitignored), one per target: `pilotcli-<os>-<arch>`. Use `linux/arm64` for an ARM server and `darwin/amd64` for an Intel Mac mini.

4. **Pick each machine's name.** It is what `runs_on` matches, ignoring case and surrounding spaces, and nothing else: "Mac-mini" isn't "Mac mini". Every script requires `--machine-name`.
5. **Update every engine before an automation gets `runs_on`.** An older engine reads `runs_on` as an unknown key, marks the file invalid and never ticks it (README, "Rollout").

On each new machine:

- **Git access to `nsitapara/agents` and `nsitapara/pilotCLI`.** Both are private. The scripts clone them to `~/.agents` and `~/Documents/GitHub/pilotCLI`. Sign git in first (`gh auth login`, then `gh auth setup-git`), or add an SSH key and pass the SSH URLs: `--agents-repo git@github.com:nsitapara/agents.git` and `--pilotcli-repo git@github.com:nsitapara/pilotCLI.git`. Pilot's own repo, `nsitapara/orca`, is public.

## macOS (the Mac mini)

### Prerequisites

- Xcode or its Command Line Tools (`xcode-select --install`). `build-mac.mjs` compiles two Swift helpers.
- Node 24, from fnm, nvm or Homebrew. The script uses whichever has Node 24. If none has it, the script stops and says how to install it (`fnm install 24`, `nvm install 24` or `brew install node@24`).
- Tailscale, signed in to your tailnet.

### Run it

    git clone -b pilot https://github.com/nsitapara/orca.git ~/Documents/GitHub/pilot
    ~/Documents/GitHub/pilot/src/packages/pilot/scripts/machine-setup/macos.sh \
      --machine-name "Mac mini" --open-at-login \
      --pilotcli-repo https://github.com/nsitapara/pilotCLI.git

Run it with `--dry-run` first to see every command.

### What it does

1. Checks Xcode's tools, `swiftc`, git and Node 24.
2. Fast-forwards the checkout to `origin/pilot`. It clones the checkout if it is missing, and leaves it alone if it has uncommitted changes. A clean checkout on another branch is switched to `--branch` (default `pilot`). It does the same for `~/.agents` (on `main`), runs `~/.agents/sync-skills.sh`, and links `~/.pilot/automations` to `~/.agents/automations`, as on the main Mac.
3. Installs pilotcli at `~/.local/bin/pilotcli`. With `--pilotcli-repo`, it clones or fast-forwards `~/Documents/GitHub/pilotCLI` and runs pilotCLI's own installer. A `--pilotcli-binary` is tried under a temporary name first: if it doesn't run here, it is deleted, the installed pilotcli stays, and the setup stops.
4. Sets Pilot's settings for this login session with `launchctl setenv`:
   - `PILOT_SCHEDULER=pinned` by default (`--scheduler all|pinned|off`): this Mac ticks only the jobs pinned to it;
   - `PILOT_VAULT_EXPORT=off` (unless `--vault-export on`): one machine exports to the vault;
   - `PILOT_USAGE_REPORT_DIR=~/Library/Application Support/Pilot/usage-report`, so this Mac never writes over the main Mac's token report in a synced vault.

   A re-run keeps each setting you leave out: it reads the LaunchAgent, then launchd, then falls back to the default. So a re-run without `--scheduler` never turns pinning off.

5. Runs `pnpm install --frozen-lockfile`, then `node src/packages/pilot/scripts/build-mac.mjs`. That builds `dist/mac-arm64/Pilot.app` (this Mac's architecture only, so `pnpm install:release` isn't needed), quits Pilot, installs `/Applications/Pilot.app`, links `~/.local/bin/pilot`, and relaunches Pilot.
6. Writes `~/Library/LaunchAgents/dev.nsitapara.pilot.environment.plist`. It runs the same `launchctl setenv` lines at every login, so the settings survive a restart. With `--open-at-login` (kept on re-runs until `--no-open-at-login`), it then opens Pilot. A changed agent is booted out, and bootstrapped once launchd has let it go.
7. Sets the machine name: `pilot host name --name "Mac mini"`.
8. Prints the pairing steps.

**Why launchd and not your shell.** `build-mac.mjs` relaunches Pilot from a cleared environment (`env -i … /usr/bin/open`, in `install-mac.mjs`). `open` starts the app through launchd, so the app sees launchd's values, from `launchctl setenv`, and never your shell's exports.

**Don't make Pilot a Login Item.** A Login Item can start Pilot before the LaunchAgent has set `PILOT_SCHEDULER`. That Pilot would tick every unpinned job, repeating the main Mac's runs. Use `--open-at-login`, which opens Pilot after the settings are in place.

The build is unsigned. On the first launch, macOS may ask you to allow the app.

## Debian or Ubuntu (headless)

### Prerequisites

- A user with sudo, on systemd. Log in as that user over SSH or a console. `su` and `sudo -u` don't start a user manager.
- x86_64 or arm64 with glibc.
- Tailscale, up: `sudo tailscale up`.
- git, to fetch the scripts: `sudo apt-get install -y git`.

### Run it

    git clone -b pilot https://github.com/nsitapara/orca.git ~/Documents/GitHub/pilot
    ~/Documents/GitHub/pilot/src/packages/pilot/scripts/machine-setup/debian.sh \
      --machine-name "Debian box" --bind tailscale \
      --pilotcli-repo https://github.com/nsitapara/pilotCLI.git \
      --add-repo ~/Documents/GitHub/pilot

### What it does

1. **Checks first**, before installing anything: it refuses to run as root (the engine is your user's systemd service, and each sudo step asks for itself), checks that `systemctl --user` reaches your user manager, and checks that the pairing code will advertise an address the main Mac can reach (below).
2. **apt packages** (the missing ones, as a printed sudo step): `git curl ca-certificates build-essential python3 unzip procps iproute2`. node-gyp compiles node-pty with python3, make and g++. The build's glibc gate reads the result with objdump, from binutils in build-essential.
3. **Node 24.** It uses any Node 24 already on PATH. Otherwise it downloads fnm v1.39.0 to `~/.local/bin/fnm`, checked against GitHub's sha256 digest of the release asset (fnm publishes no checksum file), and installs Node 24 under an fnm alias of its own, `pilot`, so your fnm default is left alone. If you'd rather have a system Node, install NodeSource's `nodejs` 24 first. Then it enables corepack, which provides the pnpm that `package.json` pins.
4. **Checkouts.** Pilot's repo, `~/.agents` and pilotcli, as on the Mac.
5. **The engine** (`linux-engine.sh`):
   - Runs `pnpm install --frozen-lockfile` and `pnpm run build:orcad`. The build compiles node-pty against the pinned Node's headers and downloads that Node. The orcad bundle carries its own CLI, so it doesn't run `build:cli`.
   - Copies `out/orcad` and its pinned Node to `~/.local/share/pilot/engine-server/versions/<build>`, and points `engine-server/current` at it. A pull or a rebuild never changes what the service runs. The last three builds are kept, and so is any build a terminal daemon still runs from.
   - Writes the files in the table below.
   - Turns on linger (`sudo loginctl enable-linger <you>`, a printed sudo step), so the engine runs at boot without a login.
   - **Pairing.** On the first run, or when the address or port changes, it does one short run of orcad with a pairing offer, its output in a private file. It reads the `Pairing URL:` line and stops that run. If orcad prints `Pairing unavailable: <reason>` instead, the setup stops with that reason and orcad's guidance. However the setup ends, even on Ctrl+C, the run is stopped and the file deleted. The service itself runs with `--no-pairing`: a service's log must never hold a pairing offer, as `orca serve service install` does. The code stays valid until a client uses it.
   - Starts `pilot-engine.service`, waits until `pilot automations status` answers, and sets the name: `pilot host name --name "Debian box"`. It registers each `--add-repo` path with `pilot repo add`.
   - Prints the command to run on the main Mac.

| File                                          | What it is                                                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/.config/pilot/engine.env`                  | The engine's settings (below). A re-run keeps each value unless you pass its flag. Lines you added, comments included, move to the end and are kept |
| `~/.config/systemd/user/pilot-engine.service` | The unit: `Restart=on-failure`, and `KillMode=process` so terminals outlive a restart                                                               |
| `~/.local/bin/pilot-engine`                   | Starts orcad with the pinned Node; waits up to 300 s for the bind address at boot                                                                   |
| `~/.local/bin/pilot`                          | The CLI for this engine (it runs the launcher orcad writes in its data folder)                                                                      |
| `~/.local/share/pilot/engine-data`            | `ORCA_USER_DATA`: orcad's profile and Pilot's store                                                                                                 |

`engine.env` holds:

| Setting                        | Default                                                                      | Flag                                           |
| ------------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------- |
| `ORCA_USER_DATA`               | `~/.local/share/pilot/engine-data`                                           | `--data-dir`                                   |
| `PILOT_SCHEDULER`              | `pinned`                                                                     | `--scheduler all\|pinned\|off` (`all` is `on`) |
| `PILOT_AUTOMATION_DIRS`        | `~/.agents/automations`                                                      | `--automation-dirs`                            |
| `PILOT_VAULT_EXPORT`           | `off`                                                                        | `--vault-export on\|off`                       |
| `PILOT_VAULT_AUTOMATIONS`      | `~/Documents/WebPortal/Agent Work/Automations` (Details bundles go there)    | `--vault-dir`                                  |
| `PILOT_USAGE_REPORT_DIR`       | `<data-dir>/usage-report` (written only once `usage-legacy.json` is in it)   | `--usage-report-dir`                           |
| `PILOT_USAGE_TEMPLATE`         | the token report's page, copied beside the server                            |                                                |
| `PATH`                         | `<data-dir>/cli/bin` first, then `~/.local/bin`, Node's folder, the system's | edit the file (the first entry is put back)    |
| `PILOT_ENGINE_BIND`, `_PORT`   | `127.0.0.1`, `6868`                                                          | `--bind`, `--port`                             |
| `PILOT_ENGINE_PAIRING_ADDRESS` | empty: the bind address                                                      | `--pairing-address`                            |

**The address.** orcad listens only on `--bind`, a literal IP. `tailscale` means this machine's `tailscale ip -4`. orcad binds exactly that address from its first start. Upstream's STA-2370 rule, which keeps the listener on loopback until a device pairs, is the desktop app's; it doesn't apply to orcad.

**What the pairing code advertises.** Left to itself, orcad advertises `127.0.0.1` whatever it binds (`src/main/runtime/pairing-endpoint.ts`), which would pair the main Mac to itself. So when `--bind` is a specific IP, such as the Tailscale one, the engine passes that IP as the pairing address. `--pairing-address` overrides it, for a hostname or another IP. `--bind 0.0.0.0` (or `::`) without `--pairing-address` is refused before anything is installed. With the default `127.0.0.1`, the main Mac can't reach the engine at all. If ufw is on, let the port in on Tailscale: `sudo ufw allow in on tailscale0 to any port 6868 proto tcp`.

**`PATH`.** A systemd user service gets a bare PATH, and orcad on plain Linux doesn't read your login shell's. Shell steps and field scripts find `claude`, `codex`, `glab` and `pilotcli` only through this PATH. Add their folders, such as `~/.local/share/mise/shims`, then run `systemctl --user restart pilot-engine`. Its first entry is `<data-dir>/cli/bin`, where orcad writes its own `orca` launcher at startup, pinned to the engine's data folder (`src/main/orcad/orcad-cli-launcher.ts`). Shell steps such as `orca worktree set …` reach the engine through it. On the desktop, Pilot puts its `bin/` first itself; under orcad it adds no launcher folder (`src/packages/pilot/src/main/engine-env.ts`). A re-run puts that entry back first, and it stays out of your own shell's PATH.

## Arch (Omarchy)

The same as Debian, with pacman:

    git clone -b pilot https://github.com/nsitapara/orca.git ~/Documents/GitHub/pilot
    ~/Documents/GitHub/pilot/src/packages/pilot/scripts/machine-setup/arch.sh \
      --machine-name "Omarchy" --bind tailscale \
      --pilotcli-repo https://github.com/nsitapara/pilotCLI.git \
      --add-repo ~/Documents/GitHub/pilot

- **Packages:** `git curl base-devel python unzip procps-ng iproute2`, plus `go` with `--pilotcli-repo`. It runs `pacman -S --needed` without `-y`, because refreshing the databases without upgrading is a partial upgrade. If pacman can't download a package, run `sudo pacman -Syu` and re-run.
- **Node 24:** any Node 24 on PATH, such as one from mise. Otherwise pacman's Node 24 LTS, `nodejs-lts-krypton` (with `npm`), unless another `nodejs` is installed, which it would have to replace. Then pacman's `nodejs` if it is 24, else pacman's `fnm` and Node 24 under fnm's `pilot` alias.
- **If real Orca is installed** at `/opt/Orca`, Pilot's orcad starts it as its browser host (`orcad-browser-provider.ts`). That is the same known gap as on macOS.

## Manual steps the scripts can't do

On every new machine:

- **Tailscale.** Install it, then sign in (`sudo tailscale up` on Linux).
- **Agent CLIs and sign-ins.** Install and sign in to what the jobs pinned there use:
  - Claude Code: `claude`, then `/login`.
  - Codex: `codex login`.
  - GitLab: `glab auth login`.
  - GitHub: `gh auth login`.

  Then re-run `~/.agents/sync-skills.sh`, which links skills into `~/.claude/skills` once Claude Code exists.

- **Linear.** Connect it in Pilot's Settings on a Mac. A headless engine has no Settings window, and Pilot's orcad keeps Linear's credential in `~/.orca` (README, Known gaps). Keep Linear jobs (13, M01) pinned to a Mac.
- **pilotcli's config.** pilotcli always reads `$HOME/.config/pilotcli/config.toml`, whatever `XDG_CONFIG_HOME` says (pilotCLI `internal/config/config.go`). Copy it from the main Mac. On Linux, give `[paths]` this machine's paths. Its defaults are macOS paths, and Pilot strips `PILOT_*` from pilotcli's environment, so `PILOT_CLI` can't stand in:

      [paths]
      pilot = "/home/<you>/.local/bin/pilot"
      glab_config = "/home/<you>/.config/glab-cli/config.yml"
      cache_dir = "/home/<you>/.cache/pilotcli"
      telemetry_file = "/home/<you>/.local/state/pilotcli/telemetry.jsonl"

  Also fix each project's `main_checkout`. `linux-engine.sh` prints this block while the file lacks it.

  Leave `paths.orca` alone. It names real Orca, and pilotcli's real-Orca checks (such as whether you are busy in a worktree there) don't work on Linux, where there is no real Orca. Never point it at the engine's `orca`: those checks must never reach Pilot.

- **The vault.** Either sync it (Obsidian Sync), or keep `PILOT_VAULT_EXPORT=off`, the default here. Details bundles are written to `PILOT_VAULT_AUTOMATIONS` either way.
- **Projects.** Clone the repos the pinned jobs name (`repo:`), and register them: `--add-repo <path>`, or `pilot repo add --path <path>`. An automation that names a `/Users/nishsitapara/...` path runs only on a Mac.

## Pair from the main Mac

**A Linux engine.** Run the command the script printed, on the main Mac. Quote the code, since zsh reads `?` as a glob:

    pilot environment add --name "Debian box" --pairing-code 'orca://pair?code=...'

For a new code, run the setup again with `--pair`. Until a client uses it, the code stays the same. When the main Mac already has this machine (a re-pair after a new address, say), remove the old pairing first. The script prints that line too:

    pilot environment rm --environment "Debian box"

**The Mac mini.**

1. On the Mac mini, in Pilot, open Settings > Remote Hosts > Remote Orca Servers > Share this Orca server > New Link.
2. Use the Mac mini's Tailscale address, and copy the `orca://pair?code=...` link. The desktop listens on loopback until a device pairs (STA-2370); a network link opens its listener (port 6868).
3. On the main Mac, run:

       pilot environment add --name "Mac mini" --pairing-code 'orca://pair?code=...'

To list or remove pairings: `pilot environment list`, `pilot environment rm --environment "Mac mini"`.

## Verify

From the main Mac:

    pilot host name --environment "Debian box"                    # the name runs_on matches
    pilot automations status --environment "Debian box" --json    # "process":"orcad", machineName, schedulerOn

On a Linux engine:

    systemctl --user status pilot-engine
    journalctl --user -u pilot-engine -f
    pilot automations status

Reboot it, and check that the engine comes back without a login (linger).

On the Mac mini: `launchctl getenv PILOT_SCHEDULER` says `pinned`, and `pilot automations status --json` says `"schedulerOn":true`.

In the main Mac's Pilot window, the new machine appears within 30 s.

## Test checklist

> **Answering a card starts an agent session on the card's machine.** Pilot resumes, forks or starts a session there to act on the answer. To test, answer only cards from a throwaway test job, and expect a Claude session on that machine. Got it (Done for you) and a card's Details start nothing.

A test job, pinned to the new machine, whose run starts no agent (shell steps only). Save it in `~/.agents/automations/` on that machine. Check it with `pilot automations validate --file <file>`, then enable it with `pilot automations enable --id <id>`:

    name: "T1 · Machine check"
    repo: pilot               # a project registered on that machine (pilot repo list)
    schedule: "*/30 * * * *"
    enabled: false
    runs_on: Debian box
    steps:
      - name: where
        agent: shell
        run: uname -a; hostname
        timeout: 30s
    powers: []

- [ ] **Activity chips.** Activity's rows show a machine chip once rows come from two machines. Options > Hosts filters by machine. A project picked in Projects covers its copy on every machine.
- [ ] **Cmd+T step 2.** Pick an agent in a workspace whose project is registered on both machines (the same git remote). The second step asks which machine to open it on. A machine without that agent reads "<Agent> not found here".
- [ ] **Inbox, Running and Automations** list items from both machines, each with its machine chip. Running has a section per machine, each with its own run limit. The sidebar counts add up both.
- [ ] **`runs_on`.** The test job ticks only on its machine. Its row reads "Runs on Debian box". Change `runs_on` to a name no machine has, and the row warns "· no connected Pilot has that name".
- [ ] **Run now picker.** The confirm bar's machine menu lists the machines that have the job, starting on the `runs_on` machine. A machine that can't start it is disabled with a reason ("· scheduler off", "· not answering"). The outcome line names the machine.
- [ ] **Offline message.** Stop the engine (`systemctl --user stop pilot-engine`). Within 30 s the Inbox reads "Debian box can't be reached: its cards aren't shown here", and Running reads "Debian box can't be reached. Losing contact doesn't stop its runs; they just aren't visible from here." Start it again, and its items come back.

## Update a machine later

- **The Mac mini.** Re-run `macos.sh`. Settings you leave out keep their current values, so `--machine-name` is all it needs. It pulls, rebuilds, reinstalls and relaunches Pilot. `--no-build` changes only the settings, the name or the pairing steps; then quit Pilot (Cmd+Q) and reopen it.
- **A Linux engine.** Re-run `debian.sh` or `arch.sh`, or just `linux-engine.sh`, which installs no packages:

      ~/Documents/GitHub/pilot/src/packages/pilot/scripts/machine-setup/linux-engine.sh

  It keeps `engine.env`'s values, so `--machine-name` and `--bind` can be left out. It pulls and rebuilds. It restarts the service only when the build or a setting changed, and terminals survive the restart.

- **pilotcli.** Re-run the setup with `--pilotcli-repo`. It fast-forwards the checkout and reinstalls. On a machine without git access, cross-build again on the main Mac, copy it over, and re-run with `--pilotcli-binary`.
- **Order.** Update every engine before you add `runs_on` to a shared automation (Before you start, step 5).

## Uninstall

**A Linux engine.**

    systemctl --user disable --now pilot-engine
    systemctl --user stop pilot-engine-pairing 2>/dev/null   # a pairing run an interrupted setup left
    pkill -u "$USER" -f "$HOME/.local/share/pilot/engine-server/"   # the terminal daemon outlives the service
    rm ~/.config/systemd/user/pilot-engine.service ~/.local/bin/pilot-engine ~/.local/bin/pilot
    systemctl --user daemon-reload
    rm ~/.config/pilot/engine.env
    rm -rf ~/.local/share/pilot          # the engine and its data, Pilot's store included
    sudo loginctl disable-linger "$USER" # only if nothing else needs it

Then, as they apply:

- **A custom `--data-dir`** lives outside `~/.local/share/pilot`. Delete it too (`ORCA_USER_DATA` in `engine.env` names it, so read it before removing that file).
- **`~/.pilot/automations`** is a link to `~/.agents/automations`. Remove the link with `rm ~/.pilot/automations`, never `rm -rf ~/.pilot/automations/`: with a trailing slash that deletes the automations themselves.
- **`~/.local/share/pilot-setup`** holds a Go the setup downloaded for `--pilotcli-repo`. Delete it.
- **fnm**, if the setup installed it: `~/.local/bin/fnm` and `~/.local/share/fnm` (Node 24 under the `pilot` alias). Delete them if nothing else uses fnm.

**The Mac mini.**

    launchctl bootout gui/$(id -u)/dev.nsitapara.pilot.environment
    rm ~/Library/LaunchAgents/dev.nsitapara.pilot.environment.plist
    launchctl unsetenv PILOT_SCHEDULER; launchctl unsetenv PILOT_VAULT_EXPORT; launchctl unsetenv PILOT_USAGE_REPORT_DIR

Then quit Pilot, and delete `/Applications/Pilot.app`, `~/.local/bin/pilot` and, to drop its data, `~/Library/Application Support/Pilot`.

**The main Mac.** Forget the pairing: `pilot environment rm --environment "Debian box"`.

## Linux desktop app (follow-up)

Not supported: `arch.sh --desktop` refuses, and the headless engine is the Linux path. A Pilot-branded Linux app needs packaging work that doesn't exist yet:

- Pilot's electron-builder wrapper (`build/electron-builder.config.cjs`) sets `productName`, `appId` and the Linux `executableName: pilot`. But it keeps Orca's Linux resources. The CLI launcher `resources/linux/bin/orca-ide` looks only for `orca-ide`, `orca` or `Orca`, so it can't find a `pilot` executable. It also doesn't pin Pilot's data folder, so the CLI would act on real Orca's `~/.config/orca` (`src/cli/runtime/metadata.ts`).
- The deb and rpm hooks (`resources/linux/packaging/after-install.sh`) manage `/opt/Orca` and `/usr/bin/orca-ide`.
- There is no Pilot Linux build script or test. Upstream's `pnpm build:linux` builds Orca-branded AppImage, deb and rpm.
- Packaging checks native modules against the desktop's glibc floor (Ubuntu 20.04, `verify-linux-glibc-floor.cjs`). A rolling-release host like Arch is likely to fail it, unless the build runs in an older container.

What it would take: a Linux `bin/pilot` launcher that pins `~/.config/Pilot`, Linux `extraResources` overrides in Pilot's wrapper, a `build-linux.mjs` (`--linux dir` is enough for one machine), and a test like `electron-builder.config.test.ts`'s macOS one.

## Known limits

- **Approvals stay with the machine's own window.** A headless engine's cards can be answered but never approved. Keep jobs that need approval on a Mac.
- **Job 14 serves only its own machine.** A job that posts prepared cards needs 14 on the same machine.
- **orcad also runs Orca's own automation engine** (README, Known gaps). A fresh engine has no Orca automations.
- **Building orcad on a rolling distro.** The node-pty slot is checked against glibc 2.28 and libstdc++ `GLIBCXX_3.4.25` (`config/scripts/verify-linux-glibc-floor.cjs`). CI builds it on Ubuntu 24.04. A much newer compiler, such as Arch's, could reference newer symbols, and the build then fails with the offending names.
