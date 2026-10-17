# Pilot

Pilot is Nish's fork of Orca (`github.com/nsitapara/orca`), with Automations rebuilt: automations that check each MR, worktree or ticket, an Inbox, timelines and agent actions. The spec and decision log are in the Obsidian vault: `Agent Work/Automation platform - Spec.md` and `Agent Work/Automation platform.md`.

- **The drop-in rule:** everything Pilot adds lives in this folder. Upstream files only gain the hooks listed in `HOOKS.md`.
- **Update from upstream:** `node src/packages/pilot/scripts/update.mjs` (see the script's `--help`).
- **Dev:** `node src/packages/pilot/scripts/dev.mjs` runs `pnpm dev` with a separate `pilot-dev` data folder, its own automations folder (`pilot-dev/automations`) and the scheduler off. Set `PILOT_AUTOMATION_DIRS` or `PILOT_SCHEDULER` yourself to override either.
- **Scheduler:** only one Pilot ticks automations, because each data folder has its own `handled` table. With `PILOT_SCHEDULER` unset, only the packaged desktop app ticks; dev, `--serve` and orcad don't. `PILOT_SCHEDULER=on` turns it on in any of them, and `off` turns it off everywhere.
- **Build for macOS:** `node src/packages/pilot/scripts/build-mac.mjs`. It installs by default, so Raycast and Spotlight find `/Applications/Pilot.app`:
  - After the build it quits the running Pilot (waits up to 30s for the main process to exit, never force-kills), replaces `/Applications/Pilot.app` with `ditto`, links `~/.local/bin/pilot` to the installed launcher, runs `lsregister -f`, and relaunches Pilot from a cleared environment (no `ORCA_*`). It then waits up to 60s for `pilot automations list-yaml` to answer (otherwise it exits non-zero with the log folder, `~/Library/Application Support/Pilot/logs`) and prints the build commit, the install path and the enabled automations.
  - `--no-install` builds only (the app stays in `dist/mac-arm64/Pilot.app`). `--no-launch` installs but doesn't relaunch.
  - `dist/.metadata_never_index` keeps Spotlight off the `dist/` copy. The steps live in `scripts/install-mac.mjs`.
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
- It refuses to import into Pilot's data folder while Pilot is running (a `Pilot.app/Contents/MacOS/Pilot` process, or `SingletonLock` / `orcad.lock` there). A different `--pilot-data` folder is refused only by its own lock files.
- It refuses, changing nothing, when Orca's database isn't the layout it was written for: a profile-state schema other than 3, a `domain_version` other than 1, or a whitelisted domain that is missing, `null` or the wrong JSON type (what upstream leaves behind when it moves a domain into its own table). Update the script from upstream's `src/main/persistence/profile-state/` code first.
- **Pruning backups:** nothing deletes them. `--list` shows each set by stamp. Once Pilot has started cleanly on a newer import, delete an old set by hand, e.g. `rm ~/Library/Application\ Support/Pilot/profiles/local-default/*.pre-orca-import-<stamp>`. Keep the newest set until you're sure you won't need `--restore`.

## Migrating an automation

This is how 05 moved onto the M1 engine, kept for its shadow-and-cut-over steps. Every job has since been ported by the build plan "Pilot: every job on the YAML engine" (Tasks 34–46). `go-live-check.mjs` checks them all together (see "Automations on the YAML engine").

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
   - Run `pilot automations dry-run --id <id>`. It checks every item and prints what a tick would do with each. Nothing starts and nothing is stored.
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

## Pilot beside Orca

Both apps can run at once, each with its own backend and data. Pilot runs YAML automations only: Orca's own automation engine is always off inside Pilot (hook `orca-automations-off`), and there is no way back to Orca's jobs (retired 2026-10-15).

| | Pilot | Orca |
|---|---|---|
| App | `dist/mac-arm64/Pilot.app`, port 6868 | `/Applications/Orca.app`, port 6768 |
| Data | `~/Library/Application Support/Pilot` | `~/Library/Application Support/orca` |
| Jobs | YAML automations (Orca's own engine is off) | none: the Orca-style jobs stay disabled |
| `orca` in its terminals and prechecks | reaches Pilot | reaches Orca |

What follows from that:

- **Keep Pilot open.** Its jobs run only while Pilot runs, and the ones that start an agent need its window. Launch it from the Dock or Finder. Launched from an Orca terminal, it inherits that terminal's `ORCA_*` routing.
- **Prechecks reach the app that runs them.** A precheck runs with the app's own environment. Pilot sets `ORCA_USER_DATA_PATH` to its data folder, so even `/opt/homebrew/bin/orca` (real Orca's launcher) answers from Pilot. Verified with a probe job on 2026-10-11.
- **Agent tabs open where the job runs.** Tabs a job opened in Orca before the move stay in Orca, and Pilot's sweeps can't see them.
- **History:** each app keeps its own runs.
- **A restart can skip one slot.** A slot missed while Pilot was closed is retried at launch. That retry can come before Pilot has loaded its projects, and then it's recorded as `skipped_unavailable` ("The target project is no longer available."). The next slot runs normally. To cover the gap, use the automation's Run now in Pilot. Seen 2026-10-11 10:10 for 05 and 12.

## Automations on the YAML engine

Every job is a YAML automation in `~/.agents/automations/` (one file per automation; the file name is its id). Orca's own automation engine doesn't run in Pilot's desktop app or `serve` (hook `orca-automations-off`); Pilot's `orcad` keeps upstream's engine. The format is the contract in the build plan "Pilot: every job on the YAML engine". Check a file without the app: `pilot automations validate --file <file>`.

- **Commands** (all take `--json`):
  - `pilot automations list-yaml`, `show-yaml --id` (alias `get`), `reload` (`pilot automations list` is upstream's own command)
  - `enable --id`, `disable --id`
  - `validate --file`, `dry-run --id`, `tick --id`, `activity --id`
  - `import-state --id [--apply]`
  - `spend`, `usage-report`
- **Nothing runs until Nish switches it on** (build plan Task 50). An automation's first tick shows in its Activity and in the worktree panel.
- **A run's tabs close when it ends**, however it ends (`main/run/ended-run-tabs.ts`). Once every run on an agent tab has ended, the scheduler's next poll (every 15 s) closes it, and Resume reopens the session. A tab is found by its handle or its pane, since a restart can give the terminal a new handle. A tab stays when:
  - its last step has no session id to resume;
  - a turn began there after that step ended (someone took it over);
  - it runs another session now, or its agent exited;
  - someone is typing in it, or its agent is busy (looked at again next poll);
  - a launch, Resume or answer is opening its session.
- **Go-live check:** `node src/packages/pilot/scripts/go-live-check.mjs --help`.
  - It validates every file, dry-runs each automation in a scratch Pilot, and summarises the parity tests as a vault section.
  - It also flags a Codex step whose args repeat an option of the configured Codex command, and refuses a `--data` link to the packaged app's folder.
  - Build plan Task 47b has the steps for the scratch Pilot. It mirrors the packaged app's data, and `import-orca-settings.mjs` can fill it while the packaged app runs.

### Shell steps

A shell step's `run:` is plain shell. It takes no `{placeholders}`; validation rejects them.
- **Values in:** `env: { NAME: "{mr.title}" }`. The script reads `"$NAME"`. Pilot fills the text in; the shell never parses it. A missing or null value fails the step at start, unless the placeholder ends in `?` (`env: { SAID: "{steps.test.outcome?}" }`): then it renders as empty text. `?` works in a shell step's `env:` only.
- **Values out:** append `key=value` lines to `$PILOT_OUTPUT_FILE`. The last line per key wins. Declare the keys a later stage relies on with `outputs: [key]` (Multi-stage jobs, below). A value that reads as JSON (`true`, `3`, `null`) becomes that value. Stdout is never read for outputs, so what a child process prints can't forge one, and neither can `pilot run output`: Pilot refuses run-channel writes to a shell step. `pilot run output` works only from an agent step's own terminal (`PILOT_RUN_ID`/`PILOT_STEP_IDX` only choose among the steps running there). Names are letters, digits and `_`; a value is at most 4096 characters. A bad line is a warning, not a failure.
- **Results:** when a shell step's whole stdout (trimmed) is one pilotcli envelope (`v: 1`, `command`, `outcome`), Pilot keeps it as the step's result, `{command, outcome, reason, data, meta}` (`steps.result_json`).
  - `data` over 256 KB is dropped (`data_omitted: "too large (N KB)"`).
  - A result marked `meta.text` keeps only `{command, outcome, reason}` (`data_omitted: "may contain comment or ticket text"`), and none of the step's stdout is kept: `output_tail` holds a note in place of stdout, then stderr, and an error never quotes stdout.
  - No stdout is kept from a capture cut at 1 MiB that doesn't read as one envelope either (a cut envelope can't be told from a text one). `output_tail` says so: "(stdout not kept: it passed 1 MiB and was cut, so Pilot can't check it for comment or ticket text)".
  - With an envelope, a step's error uses its `reason`, never the JSON line.
  - The run page shows each result's command, outcome and reason, and its data as JSON, folded until opened. The vault export (`Runs.md`) never includes data.
- **Exit codes:** `exit_codes: { ok, skip, stop }`, `ok: [0]` by default; a code may be in one list only.
  - `ok` → done. `skip` → skipped, and the run goes on.
  - `stop` → stopped: the run ends there as done, with the outcome "Nothing to do: <reason>" (the envelope's reason, else the step's last line). Every later non-`always` step is skipped; `always` steps still run and read `{steps.<name>.status}` as `stopped`. The `once_per` key is settled done.
  - Only a non-`always` step can stop the run, as only one can fail it.
- **Results in later steps:** `{steps.<name>.result}` is the result's `data` as compact JSON; `{steps.<name>.outcome}` and `{steps.<name>.reason}` are strings; `previous.*` reads the step just before. They win over outputs of the same name; `{steps.<name>.status}` stays Pilot's own.
  - A result whose data wasn't kept (`data_omitted`) reads as missing.
  - A prompt or `env:` value that would render a `result` over 32 KB fails its step: "steps.<name>.result is N KB, over the 32 KB cap". It is never cut.
  - `run:` still takes no placeholders: pass a result through `env:`. Pilot never lifts fields out of `data`; single values come from `$PILOT_OUTPUT_FILE`.
- **Reserved env names:** `PATH`, `IFS`, `HOME`, `ENV`, `BASH_ENV`, `SHELLOPTS`, `BASHOPTS`, `PS4`, `CDPATH`, `GLOBIGNORE`, `AGENT_RUN`, and anything starting `PILOT_`, `ORCA_`, `LD_` or `DYLD_`.
- **Never** use an env value in `$(( ))`, `(( ))`, `let`, `declare -i`, an array subscript, `[[ -eq ]]`, `eval`, or `sh -c "…$NAME…"`. The shell evaluates those as code. Quote it as `"$NAME"`, or validate it first.
- **Never** put an item value in an env name that another program executes: `NODE_OPTIONS`, `GIT_SSH_COMMAND`, `GIT_CONFIG_*`, `PERL5OPT`, `JAVA_TOOL_OPTIONS`, `SHELL`, `EDITOR`, `PAGER`. Validation doesn't block these.

### Multi-stage jobs (`job:`)

A job ported as several automations, such as 13's ticket step and its fix sessions, shows as one job. Each automation is a **stage** of it. ("Step" already means the steps inside an automation.)

**Stages or steps?**
- **Steps** run one after another inside one run, on one item, in one workspace. Use them when the later work belongs to the same item and should run right away (review, then fix).
- **Stages** are separate automations with their own items, schedule, checks, `once_per`, limits, quota and switch. Use them when the next part works on different items than the first produced (a pipeline opens a ticket; the ticket gets a fix session), or needs its own gates or timing.

**The YAML.** The sending stage lists its connections under `feeds`; the receiving stage reads what it is fed.

    # stage 1
    job:
      id: "13"                            # the stages of one job share it (quoted text)
      name: Fix red hourly e2e on dev     # the job's name; at least one stage sets it
      stage: 1                            # whole number from 1, its place in the job
      label: Open or update the ticket    # the stage's short label
      feeds:
        - to: dev-e2e-fix-start           # a stage of the same job
          pass: { id: ticket }            # this run's `ticket` output becomes the next stage's item ids
          run: now                        # now (tick it as soon as this run ends) | next_schedule (the default)
          when: success                   # success (the default: the run ended done or needs you) | always
          caption: the tickets it opens   # the arrow's caption on the job page
    steps:
      - name: ticket
        agent: shell
        run: ./ticket.sh                  # appends ticket=WEB-2123 (or WEB-1,WEB-9) to $PILOT_OUTPUT_FILE
        outputs: [ticket]                 # a pass may hand on only a declared output

    # stage 2
    job: { id: "13", stage: 2, label: Start a fix session per ticket }
    items:
      kind: linear_ticket
      where:
        ids_from: { feed: true, run: "python3 /abs/pilot_mode.py list-fix-tickets", field: identifier }

- **The old shape** still loads: `feeds: <name>` (or a list of names) with `hands_over: <caption>` is an arrow only, with no handover. `hands_over` captions only feeds given by name; a connection has its own `caption`.
- **An output's value** may name several ids, separated by commas or spaces. `pass` reads the output only from a step that declares it in `outputs:`; the same key reported by any other step is ignored. When two declaring steps report it, the later one wins.
- **Agent steps:** an agent writes its own outputs, so `pass` reads an output an agent step declares only when the connection says `trust: agent`. Without it the loader refuses the pass.
- **`ids_from: { feed: true }`** reads the ids earlier stages handed over. Only `linear_ticket` stages take it for now (`ids_from` is a `linear_ticket` clause). With `run:` too, a fed id is read only when the command lists it as well: the feed makes the stage faster, never wider. A fed id the command doesn't list yet waits, pending, until it is listed or expires (Activity warns "… isn't in the stage's own list yet; it waits"). The command also picks up ids that never came through a feed (opened before the stage existed, or while it was off).
- **Trust note:** a stage with `feed: true` and no `run:` trusts what it is handed, checked only by the id format (WEB-123, at most 40 characters, 25 a run) and its source's own `where:` filters (team, state). Give it its own `run:` list when only some items should ever reach it.

**Guarantees.**
- **Durable:** when a sending run ends and `when` holds, each id is written to the store's `handovers` table, once per (sending run, receiving stage, id), and a stage has at most one pending row per id: handing over an id that already waits refreshes that row (the latest sending run), and its 7 days still count from the first handover. A pending id survives a restart.
- **Consumed only when settled:** each real tick of the receiving stage (triggered or scheduled) reads its pending ids. It consumes an id only when the tick started a run for the item (or recorded an ask-first card and its run), keeping that run's id, or the item definitely needs nothing: out of scope, already handled (its `once_per` key, or a baseline; the id keeps the run that holds the key, so that run failing re-pends it), or gone from its source (closed, or not found). Anything that can change by the next tick keeps the id pending, to be retried: quota, a failed check, a busy worktree, the per-tick limit, a failed run's `retry_after_failure` wait, a scope that says not yet. A failed tick consumes nothing. A run started for a fed id that fails or times out puts the id back to pending, so `retry_after_failure` picks it up.
- **Expiry and pruning:** an id still pending after 7 days expires. It is kept, marked expired, and Activity shows "Handover of WEB-2123 from stage 1 expired after 7 days" on the receiver's tick that found it (a receiver that is off has its ids expired by the scheduler pass instead, and its Activity shows the same line under its last tick, or as an entry of its own when it never ticked). Consumed and expired rows older than 30 days are pruned. The scheduler pass does both at most once an hour.
- **The receiver's own rules apply:** a triggered tick is an ordinary tick of that stage, so its switch, checks, `once_per`, limits and quota apply unchanged. A stage that is off, invalid or missing is never triggered; its ids wait.
- **`run: now`** ticks the receiver as soon as the sending run ends, but only after it handed over at least one id (a feed without `pass` always triggers). A receiver whose tick is already running gets one more tick after it ends. At most 4 triggered ticks of a stage a minute; past that, the ids wait for its schedule. Only the process that runs the scheduler triggers.
- **No loops:** feeds never form a cycle (the loader refuses one).
- **Dry runs** never write a handover, consume one or trigger anything. They say what they would read and hand on.
- **Not handed over:** runs that apply an answer, and imported runs.

**Validation.** A broken rule marks the involved automation invalid (shown from its last valid version, never ticked), and the error names the rule.
- In one file: a `pass` output must be declared by a step; a stage is fed once per connection; `ids_from.feed` needs `job:`.
- Across files: a stage number is used once per job; the stages that set `name` agree; feeds never form a cycle; a feed that passes ids or runs now must reach a stage of the same job; a stage passed ids must read them (`ids_from: { feed: true }`); a stage that reads its feed must be the `to` of some passing feed.
- An arrow-only feed whose target is missing (renamed), in no job or in another job only loses its arrow: a warning, and the stage still ticks.
- `pilot automations validate --file` checks one file, so a rule across files shows in the list's errors and in `reload`.

**Where it shows.**
- **The list** shows the job as one row (its id and name, an "N stages" chip, on when any stage is, the newest tick of any stage), with its stages under it in stage order.
- **The list's Status switch** turns an automation on or off (`enabled:` in its YAML) through `pilot.automations.setEnabled`, without asking. A job's row reads "Partly on" when only some stages are on; its switch turns every on stage off, or, when none is on, every stage on. A refusal shows above the list. The parity tests don't pin `enabled`, so flipping a switch keeps them green.
- **The job page** shows the stages as cards joined by their arrows. Each arrow shows its caption and the most recent handover with how it went ("Last: WEB-2123 started · 5 min ago", or "waiting" while pending). It has one Activity timeline with each tick tagged by its stage, and each stage's YAML.
- **Activity** says which run triggered a tick and what it handed over ("Triggered by stage 1 run …, handed over WEB-2123"), and which handed-over ids a tick read.
- **Dry run all** dry-runs every stage in order and says what each would read and hand on ("1 run would hand stage 2 its ticket output if it succeeds; stage 2 then ticks at once"). `pilot automations dry-run` prints the same lines.
- "Turn on" (it asks first) and "Turn off" set every stage through the same call, and the same caller rules, as one automation.
- An automation without `job:` is a job of its own, as before. The card's one-line description is the first line of the file's opening comment.

### Item ids from a command (`where.ids_from`)

A source can read only the ids a command names, instead of listing everything and dropping what isn't its own. `linear_ticket` takes it (13-start reads the tickets job 13 opened). `feed: true` adds the ids an earlier stage hands over (Multi-stage jobs, above); `field`, `env` and `timeout` belong to `run`.

    where:
      ids_from: { run: "python3 /abs/pilot_mode.py list-fix-tickets", field: identifier }   # also: env:, timeout: (60s)

- **The command** runs once per tick, before any item exists, in the repo's main checkout. It is plain words run without a shell (quotes keep spaces; `|`, `;`, `>`, `*`, `~`, `$`, backticks and `{placeholders}` are refused). `env:` values are fixed text, under the shell steps' reserved names. Inherited loader and interpreter variables (`LD_*`, `DYLD_*`, `BASH_ENV`, `NODE_OPTIONS`, `PYTHONPATH`, …) are dropped. Stdout and stderr are capped at 256 KiB each.
- **Stdout** is a JSON list, or a pilotcli envelope `{v, command, outcome, reason, data, meta}` whose `data` is the list. With `field:`, each entry is an object and the id is that key; without it, each entry is the id. At most 200 ids; repeats count once.
- **Exit codes:** 0 reads the ids; 3 means no ids (nothing is read); any other exit, a timeout or the cap fails the tick with the command's last line.
- **The source** then reads each id on its own (Linear: by identifier, read only). An id Linear can't find (its "Entity not found") is skipped, and the tick says so in Activity ("WEB-2123 isn't readable in Linear; skipped"); a handed-over one is dropped. Any other failed read of one id skips that id this tick, with a warning (a handed-over one stays pending): only a failed listing fails the tick. The where block's other clauses still apply. Without a listing, there is no implicit "assigned to me", so say `assignee:` when that matters.

### Field scripts (`items.fields`)

A custom field runs its script once per tick (`cache: per_tick`) or per commit (`per_head`), with the item on stdin; its stdout is the value.
- **Exit 3** means the item isn't due now. It is skipped this tick, with the script's last line as the reason (stdout first, as for `check: { run }`).
  - No run starts, nothing is marked failed, its `once_per` key is untouched, and a handed-over id stays pending.
  - The item's later field scripts and its script checks don't run. The cache never stores a skip.
  - Scope, `once_per` and `first_seen` come first: an item already handled still reads "Already handled".
- **Any other non-zero exit**, a timeout, or a script that can't start gives the field null and a warning.

### Job environments (`workspace: { env }`)

A job that changes code on Nish's work, or needs a stack, says what it needs. pilotcli decides where it runs and makes that place (pilotcli milestone 4, §8). Pilot calls pilotcli around the run.

    workspace:
      env:
        worktree: "{worktree.path}"     # or: branch + at, or: new_branch + from (+ keep)
        writes: true
        stack: when_backend             # never (default) | backend | full | when_backend | "{field}" holding one

- **One subject:**
  - `worktree` (optionally `at: <commit>`);
  - `branch` + `at` (a teammate's branch, read-only);
  - `new_branch` + `from` (+ `keep: true` for a new worktree kept beside the others).

  Values are templates of the item's own fields and `run.*`: `{worktree.path}`, `{mr.branch}`, `{mr.head_sha}`, `{ticket.branch}`, `{preparation.head}`, `{run.id}`. A field the item kind doesn't carry is a load error, and so is a step's output.
- **Any mode for any subject.** pilotcli decides: an existing worktree means in place, or a throwaway at its HEAD; with none, `kept` with `keep`, else a throwaway.
  - Pilot assumes nothing from the subject.
  - It fails a run only when it asked for `--throwaway` and got in place.
  - It defers a run whose folder another Pilot run holds.
- **Flags:** YAML uses `_` (`new_branch`, `when_backend`); Pilot passes `--new-branch`, `--stack when-backend`.
- **A stack from a field:** `stack: "{mr.stack}"` reads one field when the run starts, a custom one included (`items.fields: { stack: { script: ./stack.sh } }`). Its script may exit 3 to skip the item this tick (Field scripts, above). At load, a literal must be one of the four, and a placeholder exactly one `{field}` the item kind can have. At run start the value must be a stack (`when-backend` is fine too); otherwise the run fails before `create` with "stack resolved to '<value>', expected never|backend|full|when_backend". The dry run shows the resolved stack, or that error.
- **Preparing workspace,** a run phase before step 1. It never holds up the tick, and it doesn't count toward step timeouts.
  1. Pilot takes its claim on the item's worktree. If another Pilot run holds it, Pilot passes `--throwaway "<that job> is already working in it (Pilot run …)"`: Orca can't see Pilot's terminals.
  2. Pilot runs `pilotcli env create --run <run id> …` in its own process group, then reads its envelope (exit codes as backup).
  3. `ok`: Pilot's own runtime rescans the repo and finds the folder (60 s at most).
     - `not_yet`: the run is **Deferred**. Its `once_per` key is freed, `retry_after_failure` doesn't apply, and handed-over ids stay pending.
     - `failed` or `invalid`: the run fails with pilotcli's reason.
- **During the run:**
  - Every step runs in the env's folder, with its variables (`data.env`). Pilot's own `PILOT_*` and a step's `env:` win over them. A variable named like Pilot's own (`PILOT_*`, `ORCA_*`, `PATH`, …) fails the run.
  - `{worktree.path}` stays the item's worktree. The folder is `{env.path}`; also `{env.mode}`, `{env.reason}`, `{env.file}`, `{env.stack}`.
  - So in templates and prompts `{worktree.path}` is the item's HOME worktree, while every step runs in the env's folder as its cwd: the work happens in the cwd, and a merge back targets `{worktree.path}`.
  - In place, Pilot keeps its claim until the run ends. A throwaway frees the worktree for other runs.
- **Merge back (`hold_home: true`, shell steps of env runs only).** Before the step, Pilot claims the run's home (the item's worktree) for that step alone. If another Pilot run holds it, the step gets `PILOT_HOME_BUSY="<that job> is working in <home> (Pilot run …)"`, and its script passes it on, so pilotcli skips (exit 3) with that reason. The claim ends with the step, however it ends. Placeholders don't work in `run:`, so pass them through `env:`:

      - name: merge_back
        agent: shell
        hold_home: true
        env: { HOME_WT: "{worktree.path}", TO: "{steps.push.commit}" }
        run: pilotcli git update-branch "$HOME_WT" --to "$TO" --merge ${PILOT_HOME_BUSY:+--busy "$PILOT_HOME_BUSY"}
        exit_codes: { ok: [0], skip: [3] }

  pilotcli checks Nish's own sessions in the Orca app itself (pilotcli `b3a2eff`, branch `orca-real-app`, once installed), whatever env the step gives it; `PILOT_HOME_BUSY` covers Pilot's runs.
- **The run ends, however it ends:**
  1. A throwaway's own step tabs close. A tab with text typed in it stays, and the delete waits.
  2. `pilotcli env delete <run>` runs, with `--keep-folder` for a kept worktree.
  3. `ok`, a repeat delete included, is removed. `not_yet` (its create still runs): Pilot stops that create and tries again in 15 s. `invalid`: stuck, shown on the run card, left for Nish. Anything else is retried after 1, 2, 4 … minutes (at most hourly), and the run card says so.
- **At start,** the process that runs the scheduler:
  - stops a create a crashed Pilot left running (its pid file, only if `ps` still shows that very create);
  - then runs `pilotcli env list` and deletes **only** envs whose `run` (exactly as Pilot gave it to create) is one of its own runs that has ended. It skips a `creating` row of a run it still prepares.

  Orphans and runs it doesn't know are Nish's to delete.
- **Sessions, Resume, answers:**
  - In place and kept work as before.
  - A throwaway is disposable: Resume says its checkout was removed, and no per-worktree session is kept.
  - A throwaway's card is answered in a fresh session that carries what the card said.
  - An approved answer runs in the job's same env with `writes: true`. A busy worktree means `--throwaway`, not a hold.
  - `answers: { stack: never }` (the only value for now, beside `resume:` and `else:`): the answer run keeps the job's env rules (the worktree when it is free, else a throwaway) but never starts a stack.
- **Dry run:** `pilot automations dry-run` and "Dry run all" call `env create … --dry-run true`, which makes nothing, and say "would run in place" or "would run in a throwaway: <reason>".
- **Where it shows:** each run card (Activity, the job page, the worktree panel) says where it worked, its stack and URLs, and a delete that hasn't succeeded.
- **Finding pilotcli:** `PILOT_PILOTCLI`, else `~/.local/bin/pilotcli`, else PATH. pilotcli gets no `ORCA_*`/`PILOT_*` and not Pilot's launcher folder, so its checks see real Orca.
- **Switching a job:** one at a time, after both Pilot and pilotcli are installed with env support, each checked first with `pilot automations dry-run`. Job 05's switch waits in `yaml-pending.patch`.

## Inbox and Details bundles

The sidebar's **Inbox** item sits under Automations, with a count of the cards waiting on you. Clicking **Automations** leaves it, and the Inbox sub-view persists after you leave the page; the highlight always matches what is shown.

A card carries its Details as markdown (`--details-file`) or as a structured **Details bundle** (`--details-bundle`), never both. The page renders a bundle as facts, diffs, reviews, screens and shots.

- **Folder rule:** a bundle and its files (review JSON, images) must sit inside the Automations folder, `PILOT_VAULT_AUTOMATIONS`, else `~/Documents/WebPortal/Agent Work/Automations`. The skills' `vault.AUTOMATIONS` must be the same folder, or every bundle is refused (the card is still offered, without it).
- **Limits:** a bundle is at most 2 MB, a review file 1 MB, an image 8 MB, and a bundle at most 40 blocks. An unknown block type is refused.
- **What joins the digest:** the bundle's bytes and the review files it inlines. On a plain card, images and the patch do not: images are read live, and the patch is bound through its `patch_sha256` inside the bundle and checked when an approval applies it. So an image swapped on disk after the card was added shows the new image. A prepared bundle also hashes its patch, images and check logs into an artifact manifest that joins the digest, and a changed image is refused (R-P3).
- **Commands:**
  - `pilot inbox add --details-bundle <file>` sends the absolute path; Pilot's main process reads and checks the file itself.
  - `pilot inbox show --id <id>` prints one card, with its Details.
  - `pilot inbox set-details --id <id> --bundle <file> [--head <sha>]` replaces a waiting card's bundle. An answer it had is cleared, with Pilot's reply asking again. While an answer run other than the caller is still applying that answer, it is refused (`its answer is being applied; Details not attached`). That answer run itself may re-attach it (a re-draft), which clears the answer the same way.
- **Who may attach a bundle** (`add --details-bundle` and `set-details` ask the same rule): the desktop, or the local CLI inside a Pilot run's step of the card's own automation. An unbound CLI and a paired device are refused. Only a desktop Approve applies a drafted patch.
- **Drafting:** job 14 (`14 · Prepare inbox item context`) drafts and verifies prepared cards, through item-details' `candidate` mode (R-P2). 03 and 04 no longer draft at the end of their runs.

### Context preparation

- **Opt-in (D1):** only a card whose decision needs evidence is prepared: a code change to approve (04's `bug` and `left_for_you` findings, 03's `left_for_you`), 05's push card, or a card that asks for evidence. Its producer passes `--preparation-file` (`pilotcli inbox create-card`, or `pilot_bridge.add_item(..., preparation=…)` from Python). Every other card (questions, defaults, flagged items, answer-run follow-ups) is a plain card, answerable at once.
- **A prepared card** starts **Context queued**. Job 14 claims it, generates and verifies its evidence, and completes it as **Ready for your decision**. Until then Approve, a drafted-option pick and its action are refused; any other answer stops preparation. A blocked card has **Retry preparation** (`pilot.inbox.prepareRetry`: the desktop or a paired device only), which requeues it with a new revision.
- **Evidence:** a diff must match its hashed patch exactly. A diff that `details.py` trimmed (an `omitted` file, `more_files`) passes when every shown file, omitted count and `more_files` matches the patch, and its Details say plainly what only the patch file has.
- **The lease** is a liveness hint: a claim has expired only once its 10-minute lease lapsed and its claiming step no longer runs, and always 3 hours after it was claimed (`PREPARATION_HOLD_MAX_MS`).
- **A refused request** (its shape or size: `Preparation request refused: …`) never loses the card and never offers its action: the bridge leaves a flagged **Not prepared** notice (`--not-prepared-key`, `--not-prepared-reason`) with no action, parts, switch or bundle. Pilot writes its reply `Not prepared: <reason>`, any answer closes it and runs nothing, and the run's prepared card for the same key retires it (D2). A refused seed bundle only drops the bundle. A run can't offer `push` (the catalog's `needsEvidence`) without a preparation request.
- **A prepared push** binds its evidence to its range: a committed diff from the pinned origin commit (argv[3]) to the pinned commit (argv[2]).
- **The push itself** is one pilotcli call, `pilotcli git push-branch <branch> --expect-head=<commit> --expect-sha=<origin commit> --dir=<worktree>` (`main/actions/push-branch.ts`). pilotcli fetches, checks both pins, pushes only a fast-forward, never forces and verifies, so exactly the prepared range goes out. Already published is done. Any other skip (a pin moved, not a fast-forward, not yours, the MR finished) puts the card back to you with `not pushed: <reason>`. `not_yet` (any uncommitted or untracked file in the worktree, or a merge or rebase in progress) waits on you, and the wait names the branch and worktree: `uncommitted changes (<branch> in <worktree>)`. A card's Run line is that command.
- **Mark ready** is a pilotcli call too (milestone 8; act.py no longer runs it). `mark_ready` (`main/actions/mark-ready.ts`) first learns the MR's branch (Pilot's store, else `pilotcli gitlab get-mr`; unknown waits on you) and waits on you while jobs 03–06 have open cards on that branch, then runs `pilotcli gitlab check-mr <iid> mine=true active=true author=me sha=<head> ready=true` and `pilotcli gitlab update-mr <iid> draft=false --expect-sha=<head>`: a blocker waits on you, a moved head or a finished MR is stale, and an MR already ready is done. It passes `--dir` (its checks: the worktree on the MR's branch when there is one): the card's worktree while it exists, else its repo's main checkout, since Pilot runs pilotcli from `~` (`main/actions/caller-folder.ts`); with neither, it fails before calling pilotcli. A mark_ready card's Run line is its update-mr.
- **A refreshed action** (new pinned args) and an undone early answer put a prepared card's preparation back in the queue with a new revision.
- **The list** carries a light preparation ref (state, attempt, progress, error, needs); the request comes with `pilot inbox show` and the manifest with the Details.

Rulings:
- **R-P1.** Preparation has its own scoped write path: the `pilot.inbox.prepare*` RPCs (claim, progress, complete, fail), for a `local-cli` caller bound to a live run of an `inbox_preparation` automation whose item key is the card's id, at the matching revision, holding the claim. It is the one exception to "a run-bound caller may change only its own automation's cards". `set-details` refuses prepared cards from every caller. (`prepareRetry` is a person's, not the worker's.)
- **R-P2.** Drafting and evidence moved out of 03 and 04 into job 14 plus item-details' `candidate` mode. This replaces plan Ruling 5.
- **R-P3.** Images and patches are hashed in prepared bundles, and a changed image is refused. This replaces plan Ruling 3 for prepared bundles; plain bundles keep Ruling 3.
- **R-P4.** Preparation is opt-in (D1), and a refused request never loses the card (D2, after Ruling 8): it becomes a flagged "Not prepared" notice that runs nothing, never a plain action card.
- **R-P5.** An evidence-needing decision (the `push` action, applying a drafted change) runs only from a prepared card whose preparation is ready and verified. The rule reads the card, never who added it or how the caller is bound: such a card is refused at add without a preparation request (imports are the one exception), and save, `cardToRun`, `applyScript` and `draftApproved` refuse it until it is ready. An imported or legacy push or drafted card shows **Needs evidence** with **Prepare evidence** (`pilot.inbox.prepareEvidence`, the desktop or a paired device), which queues it for job 14 with a request built from the card. A prepared push's patch is recomputed by Pilot from its pinned range (`PUSH_DIFF_ARGS`, the same command as `pilotcli git get-diff --card`).
- **Go-live:** the check's "Card details" line (read-only) counts waiting cards (open or answered), those with a bundle, and imported cards still pointing at a vault bundle.

## The worktree panel

The calendar-clock icon in the right sidebar shows the active worktree's automations (`pilot.worktree.timeline`, polled every 15 s while shown):

- **Header:** the worktree's name and its project, so it's clear which one the panel follows, and what was spent here today.
- **Next:** each automation's last check on this worktree, with its reason and when it ticks again. The ones with nothing due fold away.
- **Now** and **Earlier today:** the runs here. Each shows its status, cost and outcome, what it asked, and its steps on demand: agent or shell, mode, status, cost, outputs.
- **Resume** on an agent step switches to its tab while it's open. Otherwise it reopens the session (`claude --resume <id>`, `codex resume <id>`) in a new tab in the worktree.
- **Inbox:** this worktree's open items. They're answered on the Inbox page.
- **The badge:** the icon counts what waits on you here, or shows a dot while a run is going (hook `right-sidebar-badge`).

An automation's Activity tab shows the same run cards: the run status in plain words (Asking first, Running, Needs you, Done, Failed, Timed out, Cancelled), the steps with Resume, and what each run asked. Its Overview lists the steps in order.

## Spend and token usage

**Per step.** When an agent step ends, Pilot reads its tokens from the agent's own logs, only inside the step's start-to-end window:
- Claude: its transcript and its subagents' transcripts.
- Codex: its rollout.

Each step's tokens are:
- priced with the tables Pilot shares with Orca,
- kept per day and model (`step_usage`), so a transcript Claude prunes later changes nothing.

A run costs the sum of its steps. A Claude step's session id is pinned at launch; a Codex step keeps the first session id its tab's hooks report.

**Rollups.** `pilot automations spend [--by automation|skill|agent|mr] [--days n]` (default: 7 days, by automation), or the RPC `pilot.spend`. A step counts once it has ended.

**The token usage report.** Pilot writes job 08's files: `usage.json`, `usage.csv`, `usage-data.js`, `Token usage.html` and `Token usage.md`. They use the same paths and schema, so the vault note keeps working.
- Folder: `PILOT_USAGE_REPORT_DIR`, default `~/Documents/WebPortal/Agent Work/Automations/08 · Tally token usage by job`. HTML template: `PILOT_USAGE_TEMPLATE`, default Pilot's own `resources/usage_report.html` (shipped as `Contents/Resources/pilot/usage_report.html`; orcad writes the report without it).
- **The hand-over from job 08** was done on 2026-10-12: 08's last `usage.json` was copied to `usage-legacy.json` in that folder, and Pilot writes there only while that file is there. The packaged app refreshes the files after each measured step and at least hourly. It keeps 08's history (the legacy rows) and replaces only the sessions it measured itself.
- To write the report anywhere else, at any time: `pilot automations usage-report --out <dir>`.

## Run limit and the Running page

**The limit.** One number for every automation: how many runs may go at once. The default is no limit. Set it on the Running page (sidebar, beside Inbox), with `pilot automations capacity --set <n>|none`, or the RPC `pilot.capacity.setLimit`. An agent in a Pilot run can't change it.
- Only jobs with an agent step hold a slot. A shell-only job (01 Pull dev) never waits.
- A run waiting on you (asking, needs you) holds none, as with `limits.at_once`, which still applies on top.
- Lowering the limit stops nothing that is running.

**The queue.** An item a tick would start, past the limit, gets the verdict `queued` and waits in `run_queue`, oldest first. It keeps its place across ticks.
- When a slot frees, the scheduler ticks the job of the oldest queued item at once, whatever its schedule, so the item starts on a fresh decision.
- Run now waits in the same line, and its run is still recorded as by hand.
- An answer run or an approved ask-first card waits only for a free slot (its answer is held), ahead of the line.
- A queued item leaves the line when its job's next tick doesn't leave it waiting (it started, or isn't due), when the tick fails, or when the job is turned off (unless Run now queued it).

**Memory and the suggestion.** On each scheduler poll Pilot sums the RSS of every running agent step's terminal process tree and keeps each run's peak (`runs.peak_rss_bytes`). Shell steps and Docker's containers aren't counted.
- The suggestion is what can go to jobs (available memory plus what running jobs hold, less 4 GB), divided by the heaviest job's peak over its last 20 measured runs. It is at least 1 and at most 10.
- An enabled job not measured yet counts as 2.5 GB, as web-platform's `e2e-parallel.sh` budgets a stack, so a light job measured first can't raise the suggestion before the heavy ones have run.
- It is a suggestion only; nothing changes until you pick a number.

## Agent Console

The console (`~/.agents/skills/agent-console`) reads `pilot automations list-yaml --json` and maps each automation to its job by name:
- a name that starts with its code (`01 · …`), else
- the vault job with the same name, else
- its id.

It reads each automation's `activity`. A job whose automation is switched on takes its schedule and Run by hand from Pilot: Preview runs `dry-run`, and Run now runs `tick`. Keep `ActivityTick`, `RunRow` and `StepRow` field names stable: add fields, never rename one. (`dryRun` was dropped on 2026-10-14: dry runs are no longer stored, so Activity holds real ticks only.)

## Going live

The order, behaviour changes and follow-ups come from the build (`go-live-notes.md` and `go-live-report.md` in the build plan folder). Run the go-live check first.

**Order:**
1. Close out what Orca still has open. Let a running Orca 03 review cycle finish. Close any open Orca 04 QA run or dispatched fix: a stale Orca `run.json` that isn't `done` blocks every Pilot 04 night at `stack`.
2. The open vault cards were imported once, on 2026-10-12, and the import (which ran `vault.py export-open`) was removed afterwards. The go-live check's "Card details" line still counts imported cards that only point at a vault bundle. Answer only in Pilot (Inbox).
3. Import each job's old state before enabling it: `pilot automations import-state --id <id>` (preview), then `--apply`. 03 and 04 need their `seen.json` first. 08 must be imported before Pilot first writes its own `usage.json` (the hand-over above). 12's sent answers come in as dispatched.
4. Connect Linear in Pilot (Settings) before enabling 13 and M01. Pilot can't read Orca's Linear credential (see the Known gaps).
5. Enable the YAMLs one at a time: `pilot automations enable --id <id>`. Keep Orca's copies disabled. Enable job 14 (`prepare-inbox-item-context`) together with, or before, the first job that creates prepared cards (03, 04, 05, 09): until it runs, their prepared cards stay **Context queued** and can't be approved. Job 14 must run before any push or drafted fix can be approved, imported ones included: those come in as **Needs evidence**, and Prepare evidence queues them for it (R-P5). Plain cards never wait for it.
6. Retire `apply.py` (job 12) only once Pilot is dispatching answers. Write `<STATE_ROOT>/apply/retired` last. Nothing writes it for you.

**Not checkable in a dry run** (watch the first real run):
- Linear accepts the uuid5 write ids that 13 uses for ticket creates and fold comments.
- `claude --resume <id>` keeps the same session id on the installed CLI. If it writes a new one, a Claude resume step reads the old transcript.
- 13-start and M01 against live Linear in the packaged app (the scratch Pilot can't read its credential).

**Behaviour that differs from the old jobs:**
- **Answers** to sessions from the old system fork instead of resuming. Imported sessions have no recorded launch arguments.
- **Approvals** come only from Pilot's own window on this Mac. Paired devices can answer, skip and revise, but not approve. The local CLI can't answer cards. An approval imported from the vault comes back as a re-ask.
- **Idle tabs** that hold a session a step needs (no draft, no agent working) are closed, and the session resumes in Pilot's own tab.
- **A finished run's tabs close** (the old jobs left them open), so `session: none_open` no longer waits on a tab nobody is using.
- **Action cards** show, in a Pilot block apart from the agent's words, the exact command or args Approve runs (escaped to printable text).
- **Ticking, enabling and pausing** are yours alone: Pilot's window, a paired device, or the CLI in your own terminal. An agent in a run is refused, and a real tick (Run now) runs only in the process that runs the scheduler.
- **A definition file that turns invalid** is shown from its last valid version but never ticked until it is fixed.
- **13 and M01** list the signed-in user's Linear tickets, with no assignee clause.
- **07:** a timeout or crash is a failed run (it was a silent skip).
- **03:** needs both agents' quota (it checked only the lead's).
- **M01:** a quota-out tick skips every ticket (it deferred the fourth). A worktree linked to a ticket under another name isn't reused. A started ticket whose worktree was deleted isn't restarted.
- **13:** a "Failed again" comment waits while quota is out. A canceled ticket is absent.
- **05, 06, 03, 04:** worktree flags point at "Inbox in Pilot", not the old localhost link.
- **04:** the old `loop.py status` shows a Pilot run in progress as `start_failed`. The old sweep leaves the run alone until its deadline plus 10 minutes.
- **Leftovers:** M04 worktrees aren't cleaned up (as before).

## Remote use (D25)

Pilot keeps Orca's pairing, WebSocket server, web client and `orcad` protocols unchanged. Pilot's runtime listens on 6868 (override `PILOT_WS_PORT`), so it runs beside real Orca on 6768. Pairing links stay `orca://pair?code=...` and carry Pilot's endpoint.

### Verified 2026-10-10 (automated)

- **Pilot and Orca side by side: pass.** Run from `dist/mac-arm64/Pilot.app` (rebuilt that day), with real Orca running:

      Orca   25130 ... TCP *:6768 (LISTEN)
      Pilot  83991 ... TCP 127.0.0.1:6868 (LISTEN)

  Pilot has not paired a device, so its WebSocket listener is bound to loopback only (upstream behaviour, STA-2370).

- **Headless `orcad`: pass.** `pnpm run build:orcad` writes `out/orcad/orcad.js`. Started with `ORCA_USER_DATA=<temp dir> ORCA_CLI_INSTALL_PATH=$(mktemp -u) node out/orcad/orcad.js --port 6790` (a temp data folder, never Orca's; the install path keeps serve's CLI auto-install off PATH), it printed `[pilot] attached (orcad)` and `Bound endpoint: ws://127.0.0.1:6790`, and a pairing URL. Then, with the packaged Pilot CLI:

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
- Upstream hardcodes `~/.orca` for some files, so both apps share them.
  - **Credentials.** Each app encrypts its credentials with its own keychain key, so Pilot can't read Orca's. Connecting one in Pilot would overwrite Orca's.
    - Linear has its own folder in desktop Pilot, `~/.pilot` (hook `linear-credential-home`), so connect Linear in Pilot once.
    - Still shared, so don't connect them in Pilot: Jira (`jira/site-credential-store.ts`), Bitbucket, the speech OpenAI key, MiniMax, Z Code, and `credentials/encrypted-api-key-file-store.ts`.
    - Pilot's orcad (plain Node) still uses `~/.orca` for Linear.
  - **Agent hook scripts** in `~/.orca/agent-hooks`. Both apps install them, and they reach their app through each terminal's environment. Not checked: whether different upstream versions rewrite each other's scripts.
- Upstream orcad starts `/Applications/Orca.app/Contents/MacOS/Orca --serve` (then `~/Applications/Orca.app`) as its browser host whenever it exists, and only reads `ORCA_BROWSER_EXECUTABLE` if that fails (`orcad-browser-provider.ts`). It starts before Pilot's orcad hook runs. Pilot can't redirect it without editing upstream; its only protection is that the sidecar inherits `ORCA_CLI_INSTALL_PATH` (set by the `bin/pilot` launcher) so its CLI install can't touch real Orca's `orca`. A test that SIGKILLs orcad leaves that host running; Pilot's Vitest sweep (`vitest-orcad-sidecar-sweep` in `HOOKS.md`) stops such orphans before and after each run, but an orcad you kill outside Vitest still leaves one: `pgrep -fl -- '--serve .*orcad-browser-'`.
- Pilot's orcad still starts Orca's own automation engine (`src/main/orcad/orcad-automations.ts`): the `orca-automations-off` hook covers desktop and serve only. Pilot's own scheduler doesn't run in orcad unless `PILOT_SCHEDULER=on`.
- No idle-night drafting drain: a card the 03 or 04 draft step left undrafted waits for that branch's next run.
- Images in a Details bundle are not bound to the digest; they are read live.
- Codex subagent rollouts (child threads) aren't added to their parent step's usage; `usage.py` added them.
- Pilot's Claude price table differs from `usage.py`'s for Sonnet 4 and 4.5 long-context and for old models. That is intended.
- Resume runs the agent's plain resume command, without the Settings default arguments a launch gets.
- The badge shows on the Automations icon in the activity bar, not in its overflow menu.
- Spend and the token report count a step once it has ended; a running step shows up after it ends.
- Approvals come only from Pilot's own window on this Mac (see "Going live").
- The powers `commit`, `post`, `reply`, `remove_worktree` and `close_session` are labels only: nothing enforces them. Only catalog actions are gated by a power (`push`, `mark_ready`, `create_ticket`, `update_ticket`).
- `pnpm lint` shows 5 import-cycle warnings under `mobile/`. They are upstream's, identical on `upstream/main`.
- **Recommended follow-ups** (parked, not done):
  - Per-step or propose-only powers, so card approval is the only path for 09's `post` and 05's answers `push`. Today only the prompt keeps an agent from using its automation's power, as under Orca.
  - Sandbox agents. 04's Codex runs with `--dangerously-bypass-approvals-and-sandbox`, as Orca's launch did.
  - The Inbox page has no "done" button (imported already-sent cards need `pilot inbox tick`).
  - A paired device can't approve actions. `pilot.inbox.tick` and `reply` act on any card id (as the old vault did); they could be scoped to the caller's automation.
  - A `mr: mine` check on 05 would close the "teammate's newer MR from my branch" edge, which the old sweep also left open.
  - Engine internals: the per-session claim is in-process only (main and orcad share it only if configured to); the vault exporter writes `Runs.md` without `vault.py`'s lock; terminal lists are cached for each answers pass.
- **14's env waits on `head`.** `{preparation.head}` is empty until 14's producers send `head` in their preparation request (only a push card Pilot queues itself has one), so 14 doesn't switch before they do.
- **A quit during env create** stops it at once, but its `env delete` runs at the next start.

## Running upstream tests

When you run `pnpm test` or orcad yourself from an Orca terminal, first `export ORCA_CLI_INSTALL_PATH=$(mktemp -u)` and `export ORCA_BROWSER_EXECUTABLE=` (empty, or a non-Orca Chromium path). Upstream's serve mode auto-installs the CLI at startup, and with no `ORCA_CLI_INSTALL_PATH` it searches PATH, where an Orca terminal puts `/Applications/Orca.app/Contents/Resources/bin` first, so it can replace real Orca's `bin/orca` with a link to itself. Orcad also starts `/Applications/Orca.app` as its browser host whenever that app is installed, before it ever reads `ORCA_BROWSER_EXECUTABLE`; no env var stops that (see the Known gaps). `update.mjs` sets both for its test steps; `dev.mjs` sets only `ORCA_CLI_INSTALL_PATH`. Every Vitest run also stops any browser host a test orphaned (see the Known gaps).

## Parity tests

A job counts as ported only when its parity test passes (R17): the old sweep's own `plan()` (Python, `test/parity/run_old_plan.py`) and Pilot's dry-run tick read the same recorded inputs, and every item must get an agreeing decision (each job's table maps the old words to verdicts). Every job's old side except 04's is now frozen: its decisions were recorded into each case's `old` block (12's and 08's into their tests) before its Python was deleted, so those tests need neither `python3` nor `~/.agents/skills`, and a case without its frozen old side fails.

- Record a case from live data, GET-only (anything that could write stops the recording before it runs), for a job whose old code still exists: `node src/packages/pilot/scripts/record-parity-fixture.mjs --job 04 --case <name>`. It writes `test/parity/04/live-<name>.json`, which git ignores: recorded cases hold real MR titles, branches and usernames, so they stay on this machine. Synthetic cases are committed.
- Run the parity tests: `pnpm exec vitest run --config config/vitest.config.ts src/packages/pilot/test/parity`. They skip when the automation's YAML is missing (`PARITY_AUTOMATIONS_DIR` points elsewhere), and 04's also when `python3` or its old code is (`PARITY_SKILLS_DIR`), and say what's missing on stderr and in the suite's title. A case fails on any read the new side made that it lacks (`missed read: …`), not only on a disagreeing verdict: re-record it, or add the read to the adapter's `record_extras`.
- The harness's own tests: `cd src/packages/pilot/test/parity && PYTHONDONTWRITEBYTECODE=1 python3 -m unittest test_parity_io test_jobs`.
- A mismatch line names the item and both sides' reasons. Fix the engine, never the table.

## Updating from upstream

    node src/packages/pilot/scripts/update.mjs            # sync + verify
    node src/packages/pilot/scripts/update.mjs --build    # …and build Pilot.app and install it (quits and relaunches Pilot)
    node src/packages/pilot/scripts/update.mjs --dry-run  # show the steps only

Verifying means the hook guard, the typecheck, Pilot's tests, and the upstream tests next to each hooked file in `HOOKS.md` (whole folders for startup, orcad, updater, CLI specs, app-shell and the right sidebar; otherwise the file's own `*.test.ts(x)`). `main` is always an exact copy of `upstream/main`. GitHub's "Sync fork" button does the same fast-forward. `pilot` merges `main`. Pilot's code is all in this folder, so a merge conflict can only be in one of the hook lines in `HOOKS.md`. Fix that line, commit it with `git commit --no-verify`, and run the command again. Without `--no-verify`, the pre-commit hook's `oxfmt --write` reformats every upstream file the merge brings in, and the hook guard then fails on each one (2026-10-17). Pushing is opt-in (`--push`). `--build` runs `build-mac.mjs`, so it installs into `/Applications` the same way (use `build-mac.mjs --no-install` on its own for a build only). The command refuses to start with uncommitted changes to tracked files.
