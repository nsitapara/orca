# Pilot

Pilot is Nish's fork of Orca (`github.com/nsitapara/orca`), with Automations rebuilt: automations that check each MR, worktree or ticket, an Inbox, timelines and agent actions. The spec and decision log are in the Obsidian vault: `Agent Work/Automation platform - Spec.md` and `Agent Work/Automation platform.md`.

- **The drop-in rule:** everything Pilot adds lives in this folder. Upstream files only gain the hooks listed in `HOOKS.md`.
- **Update from upstream:** `node src/packages/pilot/scripts/update.mjs` (see the script's `--help`).
- **Dev:** `node src/packages/pilot/scripts/dev.mjs` runs `pnpm dev` with a separate `pilot-dev` data folder, its own automations folder (`pilot-dev/automations`) and the scheduler off. Set `PILOT_AUTOMATION_DIRS` or `PILOT_SCHEDULER` yourself to override either.
- **Scheduler:** only one Pilot ticks each automation, because each data folder has its own `handled` table. With `PILOT_SCHEDULER` unset, only the packaged desktop app ticks; dev, `--serve` and orcad don't. `PILOT_SCHEDULER=on` turns it on in any of them, `pinned` ticks only the jobs whose `runs_on` names this machine, and `off` turns it off everywhere. A job whose `runs_on` names another machine never ticks here, whatever the setting (see "Pilot across machines").
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

## Adding an automation

Every job has been ported (the build plan "Pilot: every job on the YAML engine", Tasks 34–46; 05 went first, on 2026-10-10), and the old sweeps, their state and the shadow-and-cut-over steps are gone. A new automation:

1. **Write the YAML** in `~/.agents/automations/`, one file per automation (the file name is its id), with `schedule: manual` until it is checked. People named in `author:` come from `people.yaml` in the same folder. Pilot reads the folder through a link, `~/.pilot/automations`. Commit in `~/.agents` through a temporary index, because other sessions commit there too.
2. **Validate:** `pilot automations validate --file <file>` prints `ok <id>` and exits 0, or prints each problem and exits 1. Parsing is strict: unknown keys fail. `people.yaml` problems show in `pilot automations status`. `pilot automations reload` re-scans the folder.
3. **Dry-run:** `pilot automations dry-run --id <id>` checks every item and prints what a tick would do with each. Nothing starts and nothing is stored.
4. **Switch it on:** set its schedule and run `pilot automations enable --id <id>`. Validate before saving a schedule change: an invalid file drops the automation until it is fixed. A schedule set while Pilot runs is walked from now, so the first real tick comes at the next slot.

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
  - `spend`, `usage-report`
- **Nothing runs until Nish switches it on** (build plan Task 50). An automation's first tick shows in its Activity and in the worktree panel.
- **`runs_on: Mac mini`** pins an automation to one machine: only that machine's scheduler ticks it. Without it, every Pilot that ticks all jobs ticks it. One line, at most 255 characters. See "Pilot across machines" for what it gates and how it is checked.
- **A run's tabs close when it ends**, however it ends (`main/run/ended-run-tabs.ts`). Once every run on an agent tab has ended, the scheduler's next poll (every 15 s) closes it, and Resume reopens the session. A tab is found by its handle or its pane, since a restart can give the terminal a new handle. A tab stays when:
  - its last step has no session id to resume;
  - a turn began there after that step ended (someone took it over);
  - it runs another session now, or its agent exited;
  - someone is typing in it, or its agent is busy (looked at again next poll);
  - a launch, Resume or answer is opening its session.

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
- One machine: a feed that passes ids or runs now joins stages with the same `runs_on`, or two stages with none, because a handover stays in the database of the machine whose run wrote it. Otherwise the sending stage is invalid. Arrow-only feeds aren't checked.
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
- **Switching a job:** one at a time, after both Pilot and pilotcli are installed with env support, each checked first with `pilot automations dry-run`.

## Inbox and Details bundles

The sidebar's **Inbox** item sits under Automations, with a count of the cards waiting on you. Clicking **Automations** leaves it, and the Inbox sub-view persists after you leave the page; the highlight always matches what is shown.

A card carries its Details as markdown (`--details-file`) or as a structured **Details bundle** (`--details-bundle`), never both. The page renders a bundle as facts, diffs, screens and shots. Job 09's old Post cards also hold a review block, which the page shows read only; a new bundle with one is refused.

- **Folder rule:** a bundle and its files (patch, images, check logs, report) must sit inside the Automations folder, `PILOT_VAULT_AUTOMATIONS`, else `~/Documents/WebPortal/Agent Work/Automations`. pilotcli finds the same folder by the same rule (`details.Root`), so the bundles it writes sit inside it; a bundle outside it is refused (the card is still offered, without it).
- **Limits:** a bundle is at most 2 MB, an image 8 MB, and a bundle at most 40 blocks. An unknown block type is refused.
- **What joins the digest:** the bundle's bytes. On a plain card, images and the patch do not: images are read live, and the patch is bound through its `patch_sha256` inside the bundle and checked when an approval applies it. So an image swapped on disk after the card was added shows the new image. A prepared bundle also hashes its patch, images and check logs into an artifact manifest that joins the digest, and a changed image is refused (R-P3).
- **Commands:**
  - `pilot inbox add --details-bundle <file>` sends the absolute path; Pilot's main process reads and checks the file itself.
  - `pilot inbox show --id <id>` prints one card, with its Details.
- **Who may attach a bundle** (`add --details-bundle`): the desktop, or the local CLI inside a Pilot run's step of the card's own automation. An unbound CLI and a paired device are refused. Adding an open card again with a changed bundle clears its answer, with Pilot's reply asking again; while an answer run other than the caller is applying that answer, the add is refused. Only a desktop Approve applies a drafted patch.
- **Drafting:** job 14 (`14 · Prepare inbox item context`) drafts and verifies prepared cards, through item-details' `candidate` mode (R-P2). 03 and 04 no longer draft at the end of their runs.

### Context preparation

- **Opt-in (D1):** only a card whose decision needs evidence is prepared: a code change to approve (04's `bug` and `left_for_you` findings, 03's `left_for_you`), 05's push card, or a card that asks for evidence. Its producer passes `--preparation-file` (`pilotcli inbox create-card`). Every other card (questions, defaults, flagged items, answer-run follow-ups) is a plain card, answerable at once.
- **A prepared card** starts **Context queued**. Job 14 claims it, generates and verifies its evidence, and completes it as **Ready for your decision**. Until then Approve, a drafted-option pick and its action are refused; any other answer stops preparation. A blocked card has **Retry preparation** (`pilot.inbox.prepareRetry`: the desktop or a paired device only), which requeues it with a new revision.
- **Evidence:** a diff must match its hashed patch exactly. A diff that `pilotcli inbox get-block diff` trimmed (an `omitted` file, `more_files`) passes when every shown file, omitted count and `more_files` matches the patch, and its Details say plainly what only the patch file has.
- **The lease** is a liveness hint: a claim has expired only once its 10-minute lease lapsed and its claiming step no longer runs, and always 3 hours after it was claimed (`PREPARATION_HOLD_MAX_MS`).
- **A refused claim** names its reason: `Preparation claim is stale: <reason>` (pilotcli reads that prefix as a skip). When the card was answered, prepared, queued again or taken by another run, the run has nothing to do: the claim at launch stops its step, and the run ends done, "Nothing to do: <reason>". A blocked card, or one out of attempts, fails the step: it waits on your Retry. Continue run refuses either kind before reopening the run.
- **A refused request** (its shape or size: `Preparation request refused: …`) never loses the card and never offers its action: the bridge leaves a flagged **Not prepared** notice (`--not-prepared-key`, `--not-prepared-reason`) with no action or bundle. Pilot writes its reply `Not prepared: <reason>`, any answer closes it and runs nothing, and the run's prepared card for the same key retires it (D2). A refused seed bundle only drops the bundle. A run can't offer `push` (the catalog's `needsEvidence`) without a preparation request.
- **A prepared push** binds its evidence to its range: a committed diff from the pinned origin commit (argv[3]) to the pinned commit (argv[2]).
- **The push itself** is one pilotcli call, `pilotcli git push-branch <branch> --expect-head=<commit> --expect-sha=<origin commit> --dir=<worktree>` (`main/actions/push-branch.ts`). pilotcli fetches, checks both pins, pushes only a fast-forward, never forces and verifies, so exactly the prepared range goes out. Already published is done. Any other skip (a pin moved, not a fast-forward, not yours, the MR finished) puts the card back to you with `not pushed: <reason>`. `not_yet` (any uncommitted or untracked file in the worktree, or a merge or rebase in progress) waits on you, and the wait names the branch and worktree: `uncommitted changes (<branch> in <worktree>)`. A card's Run line is that command.
- **Mark ready** is a pilotcli call too (milestone 8; act.py no longer runs it). `mark_ready` (`main/actions/mark-ready.ts`) first learns the MR's branch (Pilot's store, else `pilotcli gitlab get-mr`; unknown waits on you) and waits on you while jobs 03–06 have open cards on that branch, then runs `pilotcli gitlab check-mr <iid> mine=true active=true author=me sha=<head> ready=true` and `pilotcli gitlab update-mr <iid> draft=false --expect-sha=<head>`: a blocker waits on you, a moved head or a finished MR is stale, and an MR already ready is done. It passes `--dir` (its checks: the worktree on the MR's branch when there is one): the card's worktree while it exists, else its repo's main checkout, since Pilot runs pilotcli from `~` (`main/actions/caller-folder.ts`); with neither, it fails before calling pilotcli. A mark_ready card's Run line is its update-mr.
- **An undone early answer** puts a prepared card's preparation back in the queue with a new revision.
- **The list** carries a light preparation ref (state, attempt, progress, error, needs); the request comes with `pilot inbox show` and the manifest with the Details.

Rulings:
- **R-P1.** Preparation has its own scoped write path: the `pilot.inbox.prepare*` RPCs (claim, progress, complete, fail), for a `local-cli` caller bound to a live run of an `inbox_preparation` automation whose item key is the card's id, at the matching revision, holding the claim. It is the one exception to "a run-bound caller may change only its own automation's cards". (`prepareRetry` is a person's, not the worker's.)
- **R-P2.** Drafting and evidence moved out of 03 and 04 into job 14 plus item-details' `candidate` mode. This replaces plan Ruling 5.
- **R-P3.** Images and patches are hashed in prepared bundles, and a changed image is refused. This replaces plan Ruling 3 for prepared bundles; plain bundles keep Ruling 3.
- **R-P4.** Preparation is opt-in (D1), and a refused request never loses the card (D2, after Ruling 8): it becomes a flagged "Not prepared" notice that runs nothing, never a plain action card.
- **R-P5.** An evidence-needing decision (the `push` action, applying a drafted change) runs only from a prepared card whose preparation is ready and verified. The rule reads the card, never who added it or how the caller is bound: a push card is refused at add without a preparation request, and save, `cardToRun`, `applyScript` and `draftApproved` refuse such a card until it is ready. A card that needs evidence and was never prepared (a push card imported before go-live, or a card whose bundle holds a drafted patch, added without a preparation request) shows **Needs evidence** with **Prepare evidence** (`pilot.inbox.prepareEvidence`, the desktop or a paired device), which queues it for job 14 with a request built from the card. A prepared push's patch is recomputed by Pilot from its pinned range (`PUSH_DIFF_ARGS`, the same command as `pilotcli git get-diff --card`).

## New tab picker

- After you pick an agent in the Cmd/Ctrl+T picker, a second step asks which machine to open it on. It appears only when the workspace's project is set up on 2 or more online machines; otherwise the agent launches straight away. Blank Terminal never gets this step.
- The current machine opens the current workspace. Other machines open their same-branch worktree, else their main checkout.
- A machine that does not have the chosen agent installed is disabled and reads "<Agent> not found here".
- The row that starts selected is the machine last picked for this project, or else the current machine. It stays selected while it still matches what you've typed. The choice is remembered per project in localStorage under `pilot.new-tab.machine-by-project`. Enter, Enter is the fast path.
- Esc goes back to the agent list. It stops listening when the dialog closes.

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

**Recently finished.** Under the queue, folded: the last 10 ended runs of jobs that hold a slot. Ran (and a run's Took) leave out the time a run sat ended before Continue run reopened it (`runs.idle_ms`). A run that ended "Nothing to do: …" reads **Nothing to do**, here and in Activity, not Done.

**Memory and the suggestion.** On each scheduler poll Pilot sums the RSS of every running agent step's terminal process tree and keeps each run's peak (`runs.peak_rss_bytes`). Shell steps and Docker's containers aren't counted.
- The suggestion is what can go to jobs (available memory plus what running jobs hold, less 4 GB), divided by the heaviest job's peak over its last 20 measured runs. It is at least 1 and at most 10.
- An enabled job not measured yet counts as 2.5 GB, as web-platform's `e2e-parallel.sh` budgets a stack, so a light job measured first can't raise the suggestion before the heavy ones have run.
- It is a suggestion only; nothing changes until you pick a number.

## Activity across machines

Activity lists the sessions of every machine you are connected to. (Pilot's own pages do the same for every Pilot engine: see "Pilot across machines", below.)

- **Machine chip:** while the listed rows come from more than one machine, each row shows a chip with its machine's name. This covers agent rows, Pilot's tab rows and recent-worktree rows, and the worktree headers under Group by > Worktree. With one machine, no chip shows. It is the same chip the sidebar uses for a host. Machines are compared by host id, after an SSH host is merged with its managed server, so those two count as one machine.
- **Machines filter:** Activity's existing Options > Hosts filter is the machine filter. It already lists this Mac, every paired machine and every SSH host.
- **Projects filter:** a project picked here includes that project's copy on every machine, and it is listed once. The saved filter is still stored as repo ids; it is widened to every machine's copy when Activity reads it. A repo with no git remote can't be matched across machines, so it stays per machine.

Known gaps:

- A Projects filter saved before this change can hold two machines' copies of one project. The Options badge counts it as two until you change the filter once.
- Repos without a git remote that share a name get separate Projects rows that look the same.
- Group by > Project still makes one group per repo, so each machine's copy gets its own group.
- Two clones of the same remote on one machine, or a fork and the repo it came from, share one Projects row. That is how the sidebar decides what one project is.

The hooks are `activity-machines-*` and `activity-project-*` (see `HOOKS.md`).

## Pilot across machines

One Pilot window shows the Inbox, Running, Automations and Activity of every machine that runs Pilot's engine: this Mac, another Mac's packaged app, or a headless orcad. Each item is tagged with its machine, and its actions go to that machine. Pair a machine as in "Remote use (D25)", below. All of it lives in this folder: `HOOKS.md` needed no new row.

To set up another machine (a Mac, a Debian server or an Arch box), see [docs/machine-setup.md](docs/machine-setup.md).

**Finding machines.**
- This machine is always listed. Each paired environment whose pairing isn't revoked is asked `pilot.status` (5 s timeout): at the start, every 30 s while the window shows, and when an environment is added or its connection changes.
- Stock Orca (no `pilot.status`) is left out, and so is a second pairing of an engine already listed (same machine name and data folder), such as this Mac paired to itself.
- A machine that doesn't answer is listed as offline only if this window has seen it answer before (`pilot.knownHosts.v1` in localStorage); otherwise it is left out. A revoked pairing is forgotten.

**Machine tags.** Only while more than one machine is listed; with one, every page is as before.
- A chip with the machine's name (the sidebar's host chip) on Inbox cards and In motion rows, Automations rows (every machine that loaded the file; a job's row names every stage's), Activity's runs and ticks, How it runs' latest run, and the run panel's header.
- Running has a section per machine, each with its own run limit. The sidebar's Inbox and Running counts add up every machine.

**A machine that can't be reached.**
- Its items leave the page, and a line says so: "Mac mini can't be reached: its cards aren't shown here." On Running: "Mac mini can't be reached. Losing contact doesn't stop its runs; they just aren't visible from here."
- A read that fails keeps that machine's last items, with "Couldn't refresh Mac mini's cards: <error>". When every machine fails, the page shows its one error, as it does alone.

**Actions go to the item's machine.**
- **Inbox:** answers, Retry preparation, Prepare evidence, Got it and a card's Details go to the card's machine. Open worktree opens that machine's worktree. A report on another machine's card doesn't open here: "This report is on Mac mini; open it there". Apply now asks every machine whose scheduler runs.
- **Running and Activity:** a run opens, reads its steps and logs, and Resumes or Continues on its own machine. Step Source is hidden for another machine's run.
- **Automations:** the switch, Dry run and the YAML go to the row's home machine: the one that ticks it, else the one its `runs_on` names, else this machine, else the first that loaded it. The switch edits that machine's copy of the file only.
- **Nothing falls back to this machine.** With several machines listed, when a row's `runs_on` machine isn't answering, hasn't sent its list yet ("Waiting for Mac mini's list…") or is named by no listed machine, the row's actions are refused with that reason, and the list says "Automations that run on Mac mini can't be changed from here."

**Approvals stay with the owner.** This window is a paired device to every other machine's engine. There, Approve (script routes and drafted changes), Resume and Continue run are refused, and the card or step shows that machine's own words ("Approve actions in Pilot on this Mac", where "this Mac" is the card's). Answering, skipping and revising work. A headless engine has no window, so its cards can be answered but never approved: keep jobs that need approval on a machine with a Pilot window.

**Machine names.** A machine's name is the one its runtime publishes: the name set with `pilot host name`, else the macOS Computer Name, else the hostname. `runs_on`, the chips and Run now all use it. The chips show each engine's name from `pilot.status`, the name `runs_on` matches. Activity's machine tags are Orca's own and can label this Mac differently, such as "Local Mac" (Known gaps).

    pilot host name                                         # print this machine's name
    pilot host name --name "Mac mini"                       # set it ("" goes back to the detected name)
    pilot host name --name "Mac mini" --environment <env>   # set a paired machine's

The scheduler reads the name on every pass, so a rename counts from the next one.

**`runs_on`.**
- **What it gates:** scheduled ticks, the catch-up of a slot missed while Pilot was closed, the first pass's wait for repos, repo-problem reports (one recorded before the job was pinned elsewhere stops showing), and `run: now` triggers. A trigger for a job pinned elsewhere is refused and logged ("it runs on Mac mini, not Studio"), and its handed-over ids wait.
- **Queued items:** a job pinned to another machine drops its scheduled rows from this machine's queue; its owner's own tick fetches those items again. Rows queued by Run now here still run here.
- **Run now by hand ignores it:** picking the machine is the choice.
- **Names** match without regard to case or surrounding spaces, and nothing else: "Mac-mini" isn't "Mac mini". A blank or multi-line value is a parse error. An engine never refuses a name it doesn't know; the window warns.
- **Handovers stay on one machine** (Multi-stage jobs, Validation).
- **Where it shows:** "Runs on Mac mini" under the Schedule in the list and in How it runs. With one machine listed, that is all: this machine's own name isn't known then, so nothing is checked. With several, "Runs on Mac mini · can't be reached" or "· no connected Pilot has that name" warns. A folded job row shows none.

**`PILOT_SCHEDULER=pinned`** ticks only the jobs whose `runs_on` names this machine. Give it to every engine but one, so each unpinned job runs once.
- A headless orcad sets it in its environment (below).
- A second packaged Mac ticks every unpinned job by default, which repeats the first Mac's runs. Run `launchctl setenv PILOT_SCHEDULER pinned`, then quit and reopen Pilot. It lasts until the Mac restarts.

**Run now asks which machine** when more than one machine has the automation.
- The confirm bar's machine menu lists the machines that have it. It starts on the `runs_on` machine, else this machine, else another one (when this machine's scheduler is off, or it doesn't have the automation). It changes only when you change it.
- A machine that can't start it is disabled with a short reason: "· scheduler off", "· not answering", "· not connected". The outcome line names the machine ("On Mac mini: …").
- Starting a pinned job on a machine other than its `runs_on` one costs two things, and the bar says so in one muted line: a sending stage's handover is stranded on that machine, because its receiver's `run: now` trigger is refused there and the ids wait, then expire after 7 days; and that machine's own `handled` table doesn't know the owner's items, so it can redo work already done.

**Job 14 serves only its own machine.** Context preparation reads its own engine's queue. A job pinned to another machine that posts prepared cards (a code change to approve, a push) leaves them **Context queued** until 14 runs there too. `runs_on` names one machine, so keep those jobs where 14 runs.

**A headless engine.** Start Pilot's orcad as in "Remote use (D25)", with:
- `ORCA_USER_DATA=<folder>`: its data folder, and Pilot's store. Without it orcad shares real Orca's `~/.orca` (Known gaps), and Pilot's store then uses `~/.pilot/orcad`.
- `PILOT_SCHEDULER=pinned`, and `PILOT_AUTOMATION_DIRS` when its automations aren't in `~/.pilot/automations`.
- `PILOT_VAULT_EXPORT=off`: no vault export.
- `PILOT_VAULT_AUTOMATIONS=<folder>`: where its cards' Details bundles must sit (read even with the export off).
- `PILOT_USAGE_REPORT_DIR=<folder>`: its token report's folder. It writes there only once `usage-legacy.json` is in it (Spend and token usage).

**Rollout.** An engine older than this reads `runs_on` as an unknown key: its strict parser marks the file invalid, shows its last valid version and never ticks it. Update every engine before a shared automations file gets `runs_on`.

## Going live (a record, 2026-10-17)

The jobs moved from Orca's engine and the old sweeps to Pilot's YAML automations between 2026-10-10 and 2026-10-16, one at a time (`pilot automations enable --id <id>`). Orca's copies stay disabled. The open vault cards and each job's old state were imported once, and the importer was then removed with the old Python; job 12 (`apply.py`) is retired, and Pilot dispatches answers. Job 14 (`prepare-inbox-item-context`) prepares the cards that need evidence: until it has run, a prepared card stays **Context queued** and can't be approved, and plain cards never wait for it. Connect Linear in Pilot (Settings) for 13 and M01: Pilot can't read Orca's credential (see the Known gaps).

**Not checkable in a dry run** (watch a real run):
- Linear accepts the uuid5 write ids that 13 uses for ticket creates and fold comments.
- `claude --resume <id>` keeps the same session id on the installed CLI. If it writes a new one, a Claude resume step reads the old transcript.

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
- **Leftovers:** M04 worktrees aren't cleaned up (as before).

## Remote use (D25)

Pilot keeps Orca's pairing, WebSocket server, web client and `orcad` protocols unchanged. Pilot's runtime listens on 6868 (override `PILOT_WS_PORT`), so it runs beside real Orca on 6768. Pairing links stay `orca://pair?code=...` and carry Pilot's endpoint. A paired Pilot engine shows in this window's Pilot pages: see "Pilot across machines".

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

### Verified (automated): Pilot's pages in the browser

- **Browser check: 4 tests.** All 4 passed before the Telemetry tab. The Playground test changed on 2026-10-18 for the tab (Telemetry first, then the Commands tab's note) and hasn't been run since. `ORCA_BACKGROUND_LAUNCH=1 pnpm exec playwright test --config src/packages/pilot/test/web/playwright.config.ts --workers=1`. Build first with `pnpm run build:electron-vite && pnpm run build:cli && pnpm run build:web && pnpm run ensure:electron-runtime`: the helper launches `out/main/index.js`, and after a Vitest run the native modules are built for Node, so `ensure:electron-runtime` rebuilds them for Electron. It starts an isolated `serve` on a random loopback port with a temp data folder, the scheduler and vault export off, and one seeded card and automation. It pairs through the `#pairing=` link in `webClientUrl` (a runtime-scope link, so no connect screen shows) and opens it in headless Chromium. It checks:
  - Inbox shows the seeded card, in the list and open beside it.
  - Running shows the run limit panel and "Nothing is running."
  - Automations lists the seeded automation, and its switch flips as a paired device.
  - Playground opens on its Telemetry tab, and its Commands tab shows a note that it runs only on the machine Pilot runs on, with no Start button. `PILOT_PILOTCLI` names a missing file, so the Telemetry tab never runs the real pilotcli or writes to its telemetry.

  Screenshots (`inbox.png`, `running.png`, `playground.png`) land in `${TMPDIR}/pilot-web-pages-results/`.

### Pending, Nish to verify (2026-10-10)

These need a phone, a second Mac and an iPad on Tailscale. Open Pilot (`dist/mac-arm64/Pilot.app`) first. Do not use real Orca's `orca` CLI for these: it would save the environment in Orca's data.

- [ ] **Phone.** In Pilot, open the "Orca Mobile" nav entry (the name stays). Scan the QR code with the Orca mobile app on a phone that is on Tailscale. Expect Pilot's worktrees listed and a terminal that opens. The link is `orca://pair?code=...` and its endpoint is this Mac's address on port 6868.
- [ ] **Another Mac.** On a second Mac with Orca installed, run `orca environment add --name pilot-mac --pairing-code <code from Pilot's pairing screen>`, then `orca worktree list --host runtime:<environment id>` (if `--host` is rejected, use `--environment <id>`). Expect Pilot's worktrees.
- [ ] **Browser web client.** Open Pilot's web client URL (from the same pairing screen, pairing in the URL fragment) on an iPad or another machine, using this Mac's Tailscale address on port 6868. Expect the full UI, with **Inbox**, **Running** and **Automations** showing Pilot's pages. To try it without touching Pilot's real data, start a scratch server (use this Mac's Tailscale IP) and open the `pairing.webClientUrl` from the printed `orca_server_ready` line:

      DATA="$(mktemp -d)/pilot-web-dev"; mkdir -p "$DATA/automations"
      ORCA_DEV_USER_DATA_PATH="$DATA" ORCA_CLI_INSTALL_PATH="$DATA/cli/pilot" ORCA_BROWSER_EXECUTABLE= ORCA_BACKGROUND_LAUNCH=1 \
      PILOT_SCHEDULER=off PILOT_VAULT_EXPORT=off PILOT_AUTOMATION_DIRS="$DATA/automations" \
      pnpm exec electron . --use-mock-keychain --password-store=basic --serve --serve-json --serve-port 6979 --serve-pairing-address <this Mac's Tailscale IP>
- Pilot's WebSocket listener binds loopback until a device is paired (upstream STA-2370), so the network bind appears only after the first pairing. If a Tailscale address refuses the connection before pairing, that is expected.

## Known gaps

- In the browser version, the controls that act on the Mac that runs Pilot, not on your device, are hidden:
  - Run controls: a step's Resume and Source, a finished run's Resume (Running), and Continue run (a card's From run and the run panel).
  - A report's Open and a skill's Open.
  - The Playground's Start, replaced by a note that it runs only on that Mac.

  Approve works only on the desktop, and nothing pops up there when you try it in the browser: the browser's Approve is refused with "Approve actions in Pilot on this Mac", and the card stays open in the Inbox for you to approve in Pilot on that Mac.
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
- Codex subagent rollouts (child threads) aren't added to their parent step's usage; the retired `usage.py` added them.
- Pilot's Claude price table differs from the retired `usage.py`'s for Sonnet 4 and 4.5 long-context and for old models. That is intended.
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
  - Engine internals: the per-session claim is in-process only (main and orcad share it only if configured to); the vault exporter writes `Runs.md` without a lock (the retired `vault.py` took one); terminal lists are cached for each answers pass.
- **14's env waits on `head`.** `{preparation.head}` is empty until 14's producers send `head` in their preparation request (only a push card Pilot queues itself has one), so 14 doesn't switch before they do.
- **A quit during env create** stops it at once, but its `env delete` runs at the next start.
- **Pilot across machines, not done yet:**
  - A folded job row shows no "Runs on" line; its stage rows do.
  - Another machine's run panel reads, but its Resume and Continue run are owner-only, and so is Approve: approvals stay with the owner.
  - `runs_on` names one machine, not a list, and job 14 serves only its own machine.
  - Machine names can differ between Pilot and Orca: Pilot's chips use each engine's `pilot.status` name, while Activity's machine tags use Orca's own labels, which can call this Mac "Local Mac". Aligning the two is a follow-up.
  - The worktree panel shows this machine's runs only.

## Running upstream tests

When you run `pnpm test` or orcad yourself from an Orca terminal, first `export ORCA_CLI_INSTALL_PATH=$(mktemp -u)` and `export ORCA_BROWSER_EXECUTABLE=` (empty, or a non-Orca Chromium path). Upstream's serve mode auto-installs the CLI at startup, and with no `ORCA_CLI_INSTALL_PATH` it searches PATH, where an Orca terminal puts `/Applications/Orca.app/Contents/Resources/bin` first, so it can replace real Orca's `bin/orca` with a link to itself. Orcad also starts `/Applications/Orca.app` as its browser host whenever that app is installed, before it ever reads `ORCA_BROWSER_EXECUTABLE`; no env var stops that (see the Known gaps). `update.mjs` sets both for its test steps; `dev.mjs` sets only `ORCA_CLI_INSTALL_PATH`. Every Vitest run also stops any browser host a test orphaned (see the Known gaps).

## Parity tests

A job counts as ported only when its parity test passes (R17): the old sweep's `plan()` (recorded while its Python still existed) and Pilot's dry-run tick read the same recorded inputs, and every item must get an agreeing decision (each job's table maps the old words to verdicts). Every job's old side is frozen: its decisions were recorded into each case's `old` block (12's and 08's into their tests) before its Python was deleted, so the tests need neither `python3` nor the old code, and a case without its frozen old side fails. The harness's Python (`run_old_plan.py`, the job adapters, the recorder) is gone; a new case is written by hand or copied from a recorded one.

- Run the parity tests: `pnpm exec vitest run --config config/vitest.config.ts src/packages/pilot/test/parity`. They skip when the automation's YAML is missing (`PARITY_AUTOMATIONS_DIR` points elsewhere), and say what's missing on stderr and in the suite's title. A case fails on any read the new side made that it lacks (`missed read: …`), not only on a disagreeing verdict: add the read to the case.
- A mismatch line names the item and both sides' reasons. Fix the engine, never the table.

## Updating from upstream

    node src/packages/pilot/scripts/update.mjs            # sync + verify
    node src/packages/pilot/scripts/update.mjs --build    # …and build Pilot.app and install it (quits and relaunches Pilot)
    node src/packages/pilot/scripts/update.mjs --dry-run  # show the steps only

Verifying means the hook guard, the typecheck, Pilot's tests, and the upstream tests next to each hooked file in `HOOKS.md` (whole folders for startup, orcad, updater, CLI specs, app-shell, Activity and the right sidebar; otherwise the file's own `*.test.ts(x)`). `main` is always an exact copy of `upstream/main`. GitHub's "Sync fork" button does the same fast-forward. `pilot` merges `main`. Pilot's code is all in this folder, so a merge conflict can only be in one of the hook lines in `HOOKS.md`. Fix that line, commit it with `git commit --no-verify`, and run the command again. Without `--no-verify`, the pre-commit hook's `oxfmt --write` reformats every upstream file the merge brings in, and the hook guard then fails on each one (2026-10-17). Pushing is opt-in (`--push`). `--build` runs `build-mac.mjs`, so it installs into `/Applications` the same way (use `build-mac.mjs --no-install` on its own for a build only). The command refuses to start with uncommitted changes to tracked files.
