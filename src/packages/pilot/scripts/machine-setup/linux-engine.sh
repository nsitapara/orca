#!/usr/bin/env bash
# Pilot's headless engine (orcad) on Linux, shared by debian.sh and arch.sh: Node 24 for the build,
# then build orcad, install it under ~/.local/share/pilot, write ~/.config/pilot/engine.env, run it as
# the systemd user service pilot-engine.service, name the machine, and print the pairing command for
# the main Mac. Run it alone to update an engine whose packages and Node are already in place.
# Guide: src/packages/pilot/docs/machine-setup.md.
# shellcheck disable=SC2034 # SETUP_* globals belong to setup-steps.sh.
set -euo pipefail

ENGINE_SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=setup-steps.sh
. "$ENGINE_SCRIPT_DIR/setup-steps.sh"

ENGINE_CONFIG_HOME=${XDG_CONFIG_HOME:-$HOME/.config}
ENGINE_SHARE_HOME=${XDG_DATA_HOME:-$HOME/.local/share}/pilot
ENGINE_ENV_FILE=$ENGINE_CONFIG_HOME/pilot/engine.env
ENGINE_UNIT=pilot-engine.service
ENGINE_UNIT_FILE=$ENGINE_CONFIG_HOME/systemd/user/$ENGINE_UNIT
ENGINE_PAIRING_UNIT=pilot-engine-pairing
# One folder per build under versions/, and current, a link to the one the service runs.
ENGINE_SERVER_ROOT=$ENGINE_SHARE_HOME/engine-server
ENGINE_SERVER_DIR=$ENGINE_SERVER_ROOT/current
ENGINE_LAUNCHER=$SETUP_BIN_DIR/pilot-engine
ENGINE_CLI=$SETUP_BIN_DIR/pilot
# Pilot's desktop listens on 6868 so real Orca keeps 6768 (src/packages/pilot/src/main/runtime-ws-port.ts).
ENGINE_DEFAULT_PORT=6868
LINUX_FNM_DIR=${FNM_DIR:-$HOME/.local/share/fnm}
LINUX_FNM_NODE_BIN=$LINUX_FNM_DIR/aliases/pilot/bin

# Flag values. Empty means: keep what engine.env already has, else the default.
ENGINE_FLAG_SCHEDULER=
ENGINE_FLAG_BIND=
ENGINE_FLAG_PAIRING_ADDRESS=
ENGINE_FLAG_PORT=
ENGINE_FLAG_DATA_DIR=
ENGINE_FLAG_AUTOMATION_DIRS=
ENGINE_FLAG_VAULT_DIR=
ENGINE_FLAG_VAULT_EXPORT=
ENGINE_FLAG_USAGE_REPORT_DIR=
ENGINE_ADD_REPOS=()
ENGINE_PAIR=auto
ENGINE_SKIP_BUILD=0

ENGINE_MANAGED_KEYS='ORCA_USER_DATA PILOT_SCHEDULER PILOT_AUTOMATION_DIRS PILOT_VAULT_EXPORT PILOT_VAULT_AUTOMATIONS PILOT_USAGE_REPORT_DIR PILOT_USAGE_TEMPLATE PATH PILOT_ENGINE_SERVER_DIR PILOT_ENGINE_PORT PILOT_ENGINE_BIND PILOT_ENGINE_PAIRING_ADDRESS PILOT_ENGINE_MACHINE_NAME'
for ENGINE_KEY in $ENGINE_MANAGED_KEYS; do
  printf -v "ENGINE_OLD_$ENGINE_KEY" '%s' ''
done
ENGINE_HAD_ENV_FILE=0
ENGINE_KEPT_LINES=
ENGINE_RESTART=0
ENGINE_PAIRING_URL=

engine_has() { command -v "$1" >/dev/null 2>&1; }

engine_help() {
  cat <<'EOF'

Engine options (a value you leave out keeps what ~/.config/pilot/engine.env has, else the default):
  --scheduler all|pinned|off  What this engine ticks (default pinned): pinned ticks only the jobs whose
                            runs_on names this machine; all ticks every unpinned job too.
  --bind <ip>|tailscale     The address orcad listens on (default 127.0.0.1, this machine only).
                            "tailscale" uses `tailscale ip -4`. orcad binds exactly this address from
                            its first start (STA-2370's loopback-until-paired is the desktop app's rule).
  --pairing-address <addr>  Address the pairing code advertises, when it isn't the bind address
                            (needed with --bind 0.0.0.0). "none" clears it.
  --port <n>                WebSocket port (default 6868, as Pilot's desktop).
  --data-dir <dir>          ORCA_USER_DATA: orcad's profile and Pilot's store
                            (default ~/.local/share/pilot/engine-data).
  --automation-dirs <dirs>  PILOT_AUTOMATION_DIRS, ':'-separated (default ~/.agents/automations).
  --vault-dir <dir>         PILOT_VAULT_AUTOMATIONS: where cards' Details bundles go
                            (default ~/Documents/WebPortal/Agent Work/Automations).
  --vault-export on|off     PILOT_VAULT_EXPORT (default off: one machine exports to the vault).
  --usage-report-dir <dir>  PILOT_USAGE_REPORT_DIR (default <data-dir>/usage-report, a folder of this
                            machine's own, so it never overwrites the main Mac's report).
  --add-repo <path>         Register a project with this engine (repeatable), as `pilot repo add`.
  --pair / --no-pair        Print a pairing code for the main Mac. By default only on the first run,
                            or when the bind address, pairing address or port changed.
  --skip-build              Don't run pnpm install and build:orcad (use the last build in out/).
EOF
}

# Sets SETUP_SHIFT like setup_take_common_flag.
engine_take_flag() {
  SETUP_SHIFT=0
  case $1 in
    --scheduler)
      setup_need_value "$@"
      case $2 in all | pinned | off) ;; *) die "--scheduler takes all, pinned or off" ;; esac
      ENGINE_FLAG_SCHEDULER=$2
      SETUP_SHIFT=2
      ;;
    --bind)
      setup_need_value "$@"
      case $2 in
        tailscale) ;;
        *[!0-9a-fA-F:.]*) die "--bind takes a literal IP address or tailscale (orcad refuses hostnames): $2" ;;
      esac
      ENGINE_FLAG_BIND=$2
      SETUP_SHIFT=2
      ;;
    --pairing-address)
      setup_need_value "$@"
      ENGINE_FLAG_PAIRING_ADDRESS=$2
      SETUP_SHIFT=2
      ;;
    --port)
      setup_need_value "$@"
      case $2 in *[!0-9]*) die "--port takes a number" ;; esac
      if [ "$2" -lt 1 ] || [ "$2" -gt 65535 ]; then
        die "--port takes 1-65535"
      fi
      ENGINE_FLAG_PORT=$2
      SETUP_SHIFT=2
      ;;
    --data-dir)
      setup_need_value "$@"
      ENGINE_FLAG_DATA_DIR=$(setup_expand_home "$2")
      SETUP_SHIFT=2
      ;;
    --automation-dirs)
      setup_need_value "$@"
      ENGINE_FLAG_AUTOMATION_DIRS=$2
      SETUP_SHIFT=2
      ;;
    --vault-dir)
      setup_need_value "$@"
      ENGINE_FLAG_VAULT_DIR=$(setup_expand_home "$2")
      SETUP_SHIFT=2
      ;;
    --vault-export)
      setup_need_value "$@"
      case $2 in on | off) ;; *) die "--vault-export takes on or off" ;; esac
      ENGINE_FLAG_VAULT_EXPORT=$2
      SETUP_SHIFT=2
      ;;
    --usage-report-dir)
      setup_need_value "$@"
      ENGINE_FLAG_USAGE_REPORT_DIR=$(setup_expand_home "$2")
      SETUP_SHIFT=2
      ;;
    --add-repo)
      setup_need_value "$@"
      ENGINE_ADD_REPOS+=("$(setup_expand_home "$2")")
      SETUP_SHIFT=2
      ;;
    --pair)
      ENGINE_PAIR=yes
      SETUP_SHIFT=1
      ;;
    --no-pair)
      ENGINE_PAIR=no
      SETUP_SHIFT=1
      ;;
    --skip-build)
      ENGINE_SKIP_BUILD=1
      SETUP_SHIFT=1
      ;;
  esac
}

# --- Node 24 (shared by debian.sh and arch.sh) ---------------------------------------------------

linux_prefer_fnm_node() {
  if [ -x "$LINUX_FNM_NODE_BIN/node" ]; then
    PATH=$LINUX_FNM_NODE_BIN:$PATH
    export PATH
  fi
}

linux_pacman_nodejs_major() {
  pacman -Si nodejs 2>/dev/null | sed -n 's/^Version *: *\([0-9][0-9]*\)\..*/\1/p' | head -n 1
}

linux_download_fnm() {
  local asset
  case $(uname -m) in
    x86_64 | amd64) asset='fnm-linux.zip' ;;
    aarch64 | arm64) asset='fnm-arm64.zip' ;;
    *) die "fnm has no build for $(uname -m); install Node 24 yourself, then re-run" ;;
  esac
  run mkdir -p "$SETUP_BIN_DIR" "$LINUX_FNM_DIR"
  run curl -fsSL -o "$LINUX_FNM_DIR/$asset" "https://github.com/Schniz/fnm/releases/latest/download/$asset"
  run unzip -o "$LINUX_FNM_DIR/$asset" fnm -d "$SETUP_BIN_DIR"
  run chmod 755 "$SETUP_BIN_DIR/fnm"
  run rm -f "$LINUX_FNM_DIR/$asset"
}

# Any Node 24 already on PATH wins; else pacman's nodejs when it is 24 (Arch); else fnm, under an alias
# of its own ("pilot") so your fnm default is left alone.
linux_ensure_node24() {
  local distro=$1 fnm=''
  step "Node 24 (package.json engines) and pnpm"
  linux_prefer_fnm_node
  if [ "$(setup_node_major)" = 24 ]; then
    say "  Node $(node --version) at $(command -v node)"
    return 0
  fi
  if [ "$distro" = arch ] && engine_has pacman && [ "$(linux_pacman_nodejs_major)" = 24 ]; then
    run_sudo "Install Node 24 from pacman (nodejs, npm)" pacman -S --needed --noconfirm nodejs npm
    return 0
  fi
  if engine_has fnm; then
    fnm=$(command -v fnm)
  elif [ -x "$SETUP_BIN_DIR/fnm" ]; then
    fnm=$SETUP_BIN_DIR/fnm
  elif [ "$distro" = arch ]; then
    run_sudo "Install fnm, which installs Node 24 for your user (pacman's nodejs isn't 24)" pacman -S --needed --noconfirm fnm
    fnm=/usr/bin/fnm
  else
    linux_download_fnm
    fnm=$SETUP_BIN_DIR/fnm
  fi
  run env FNM_DIR="$LINUX_FNM_DIR" "$fnm" install 24
  run env FNM_DIR="$LINUX_FNM_DIR" "$fnm" alias 24 pilot
  linux_prefer_fnm_node
  if [ "$SETUP_DRY_RUN" != 1 ] && [ "$(setup_node_major)" != 24 ]; then
    die "Node 24 isn't on PATH after fnm installed it ($LINUX_FNM_NODE_BIN)"
  fi
}

# --- Settings (engine.env) -------------------------------------------------------------------------

engine_is_managed() {
  case " $ENGINE_MANAGED_KEYS " in *" $1 "*) return 0 ;; esac
  return 1
}

# Reads engine.env without running it: managed keys into ENGINE_OLD_<KEY>, other lines kept verbatim.
engine_read_env_file() {
  local line key value
  [ -f "$ENGINE_ENV_FILE" ] || return 0
  ENGINE_HAD_ENV_FILE=1
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in '' | '#'*) continue ;; esac
    key=${line%%=*}
    value=${line#*=}
    case $value in
      \"*\")
        value=${value#\"}
        value=${value%\"}
        ;;
    esac
    if engine_is_managed "$key"; then
      printf -v "ENGINE_OLD_$key" '%s' "$value"
    else
      ENGINE_KEPT_LINES="$ENGINE_KEPT_LINES$line"$'\n'
    fi
  done <"$ENGINE_ENV_FILE"
}

# <flag value> <engine.env key> <default>
engine_pick() {
  local old_name="ENGINE_OLD_$2"
  if [ -n "$1" ]; then
    printf '%s' "$1"
  elif [ -n "${!old_name}" ]; then
    printf '%s' "${!old_name}"
  else
    printf '%s' "$3"
  fi
}

# A re-run may leave --machine-name out: engine.env remembers it.
engine_default_machine_name() {
  engine_read_env_file
  if [ -z "$SETUP_MACHINE_NAME" ]; then
    SETUP_MACHINE_NAME=$ENGINE_OLD_PILOT_ENGINE_MACHINE_NAME
  fi
}

# Values are written as KEY="value", which systemd and bash both read; these characters would change them.
engine_check_value() {
  # shellcheck disable=SC1003 # '\' is a backslash, not an escaped quote.
  case $2 in
    *'"'* | *'\'* | *'$'* | *'`'* | *$'\n'*) die "$1 can't contain \", \\, \$, \` or a newline: $2" ;;
  esac
}

engine_resolve_bind() {
  local bind=$1 ip
  if [ "$bind" = tailscale ]; then
    ip=$(tailscale ip -4 2>/dev/null | head -n 1 || true)
    if [ -z "$ip" ]; then
      if [ "$SETUP_DRY_RUN" = 1 ]; then
        printf '%s' '<this machine'"'"'s Tailscale IPv4>'
        return 0
      fi
      die "--bind tailscale: \`tailscale ip -4\` gave no address. Install Tailscale and run \`sudo tailscale up\` first."
    fi
    bind=$ip
  fi
  case $bind in
    *[!0-9a-fA-F:.]*) die "--bind takes a literal IP address or tailscale (orcad refuses hostnames): $bind" ;;
  esac
  printf '%s' "$bind"
}

engine_resolve_settings() {
  local scheduler='' default_path node_dir=''
  step "Engine settings ($ENGINE_ENV_FILE)"
  case $ENGINE_FLAG_SCHEDULER in all) scheduler=on ;; *) scheduler=$ENGINE_FLAG_SCHEDULER ;; esac
  ENGINE_DATA_DIR=$(engine_pick "$ENGINE_FLAG_DATA_DIR" ORCA_USER_DATA "$ENGINE_SHARE_HOME/engine-data")
  ENGINE_SCHEDULER=$(engine_pick "$scheduler" PILOT_SCHEDULER pinned)
  ENGINE_AUTOMATION_DIRS=$(engine_pick "$ENGINE_FLAG_AUTOMATION_DIRS" PILOT_AUTOMATION_DIRS "$HOME/.agents/automations")
  ENGINE_VAULT_EXPORT=$(engine_pick "$ENGINE_FLAG_VAULT_EXPORT" PILOT_VAULT_EXPORT off)
  ENGINE_VAULT_DIR=$(engine_pick "$ENGINE_FLAG_VAULT_DIR" PILOT_VAULT_AUTOMATIONS "$HOME/Documents/WebPortal/Agent Work/Automations")
  ENGINE_USAGE_REPORT_DIR=$(engine_pick "$ENGINE_FLAG_USAGE_REPORT_DIR" PILOT_USAGE_REPORT_DIR "$ENGINE_DATA_DIR/usage-report")
  ENGINE_PORT=$(engine_pick "$ENGINE_FLAG_PORT" PILOT_ENGINE_PORT "$ENGINE_DEFAULT_PORT")
  if [ -n "$ENGINE_FLAG_BIND" ]; then
    ENGINE_BIND=$(engine_resolve_bind "$ENGINE_FLAG_BIND")
  else
    ENGINE_BIND=$(engine_pick '' PILOT_ENGINE_BIND 127.0.0.1)
  fi
  if [ "$ENGINE_FLAG_PAIRING_ADDRESS" = none ]; then
    ENGINE_PAIRING_ADDRESS=
  else
    ENGINE_PAIRING_ADDRESS=$(engine_pick "$ENGINE_FLAG_PAIRING_ADDRESS" PILOT_ENGINE_PAIRING_ADDRESS '')
  fi
  # A systemd user service gets a bare PATH, and orcad on plain Linux doesn't read the login shell's,
  # so shell steps and field scripts find tools only through this one.
  if [ -x "$LINUX_FNM_NODE_BIN/node" ]; then
    node_dir=$LINUX_FNM_NODE_BIN:
  elif engine_has node; then
    node_dir=$(dirname "$(command -v node)"):
  fi
  default_path=$SETUP_BIN_DIR:$node_dir/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  ENGINE_PATH=$(engine_pick '' PATH "$default_path")

  engine_check_value --machine-name "$SETUP_MACHINE_NAME"
  engine_check_value --data-dir "$ENGINE_DATA_DIR"
  engine_check_value --automation-dirs "$ENGINE_AUTOMATION_DIRS"
  engine_check_value --vault-dir "$ENGINE_VAULT_DIR"
  engine_check_value --usage-report-dir "$ENGINE_USAGE_REPORT_DIR"
  engine_check_value --pairing-address "$ENGINE_PAIRING_ADDRESS"
  engine_check_value PATH "$ENGINE_PATH"
  case "$ENGINE_ENV_FILE$ENGINE_LAUNCHER$ENGINE_SERVER_ROOT" in
    *[[:space:]%]*) die "these paths can't hold spaces or % (systemd reads them): $ENGINE_ENV_FILE, $ENGINE_LAUNCHER, $ENGINE_SERVER_ROOT" ;;
  esac

  say "  machine name      $SETUP_MACHINE_NAME"
  say "  scheduler         PILOT_SCHEDULER=$ENGINE_SCHEDULER"
  say "  listens on        $ENGINE_BIND:$ENGINE_PORT${ENGINE_PAIRING_ADDRESS:+ (pairing advertises $ENGINE_PAIRING_ADDRESS)}"
  say "  data folder       $ENGINE_DATA_DIR"
  say "  automations       $ENGINE_AUTOMATION_DIRS"
  say "  vault             export $ENGINE_VAULT_EXPORT; Details bundles in $ENGINE_VAULT_DIR"
  say "  token report      $ENGINE_USAGE_REPORT_DIR"
  say "  server            $ENGINE_SERVER_ROOT (current: the build the service runs)"
  case $ENGINE_BIND in
    127.* | ::1)
      warn "the engine listens on $ENGINE_BIND only, so the main Mac can't reach it. Re-run with --bind tailscale (or a LAN IP) to pair it."
      ;;
    0.0.0.0 | ::)
      if [ -z "$ENGINE_PAIRING_ADDRESS" ]; then
        warn "--bind $ENGINE_BIND listens on every interface; pass --pairing-address <IP the Mac reaches> so the code advertises a reachable address."
      fi
      ;;
  esac
}

# --- Build and install -----------------------------------------------------------------------------

engine_build() {
  step "Build orcad (pnpm install, pnpm run build:orcad)"
  # build:orcad also bundles the CLI (out/orcad/out/cli/index.js), so build:cli isn't needed here.
  run_in "$SETUP_REPO_DIR" pnpm install --frozen-lockfile
  run_in "$SETUP_REPO_DIR" pnpm run build:orcad
}

engine_service_active() {
  engine_has systemctl && systemctl --user is-active --quiet "$ENGINE_UNIT" 2>/dev/null
}

engine_stop_service() {
  if engine_service_active; then
    run systemctl --user stop "$ENGINE_UNIT"
  elif [ "$SETUP_DRY_RUN" = 1 ] && ! engine_has systemctl; then
    say "  (stops $ENGINE_UNIT first when it is running)"
  fi
}

# Copies the slot (out/orcad) and the pinned Node it names (out/runtimes/node-<sha>) out of the repo
# into versions/<build stamp>, then points current at it, so a pull or rebuild never changes what the
# service runs. The old version stays for a terminal daemon that still runs from it.
engine_install_server() {
  local out=$SETUP_REPO_DIR/out root=$ENGINE_SERVER_ROOT version sha dir current=''
  step "Install the engine ($root)"
  if [ -f "$out/orcad/.version" ] && [ -f "$out/orcad/.runtime-node" ]; then
    version=$(tr -d '[:space:]' <"$out/orcad/.version" | tr -c 'A-Za-z0-9._+-' '_')
    sha=$(tr -d '[:space:]' <"$out/orcad/.runtime-node")
  elif [ "$SETUP_DRY_RUN" = 1 ]; then
    version='<stamp in out/orcad/.version>'
    sha='<sha256 in out/orcad/.runtime-node>'
  else
    die "no orcad build in $out/orcad (did pnpm run build:orcad fail?)"
  fi
  dir=$root/versions/$version
  if [ -L "$root/current" ]; then
    current=$(readlink "$root/current")
  fi
  if [ -x "$dir/runtimes/node-$sha/bin/node" ] && [ "$current" = "versions/$version" ]; then
    say "  already installed: $version"
    return 0
  fi
  ENGINE_RESTART=1
  if [ ! -x "$dir/runtimes/node-$sha/bin/node" ]; then
    run rm -rf "$dir.next"
    run mkdir -p "$dir.next/runtimes"
    run cp -a "$out/orcad" "$dir.next/orcad"
    run cp -a "$out/runtimes/node-$sha" "$dir.next/runtimes/node-$sha"
    run cp "$SETUP_REPO_DIR/src/packages/pilot/resources/usage_report.html" "$dir.next/usage_report.html"
    run rm -rf "$dir"
    run mv "$dir.next" "$dir"
  fi
  # A running server keeps its own files; the restart in engine_start moves it to this one.
  run ln -sfn "versions/$version" "$root/current.next"
  run mv -T "$root/current.next" "$root/current"
  engine_prune_versions "$version"
}

# Keeps the current build, the two before it, and any build a running process (a terminal daemon that
# outlived its server) still runs from, as orcad's own slot cache does (orcad-artifact-cache-retention.ts).
engine_prune_versions() {
  local keep=$1 name dir others=0
  [ -d "$ENGINE_SERVER_ROOT/versions" ] || return 0
  while IFS= read -r name; do
    dir=$ENGINE_SERVER_ROOT/versions/$name
    if [ "$name" = "$keep" ]; then
      continue
    fi
    if [ "$others" -lt 2 ]; then
      others=$((others + 1))
      continue
    fi
    if grep -qsaF -- "$dir/" /proc/[0-9]*/cmdline; then
      say "  kept $name: a running process uses it"
      continue
    fi
    run rm -rf "$dir"
  done < <(ls -1t "$ENGINE_SERVER_ROOT/versions")
}

engine_env_line() {
  printf '%s="%s"\n' "$1" "$2"
}

engine_env_content() {
  {
    cat <<'EOF'
# Pilot engine settings, read by pilot-engine.service and ~/.local/bin/pilot-engine. Written by
# src/packages/pilot/scripts/machine-setup/linux-engine.sh: a re-run keeps each value unless you pass
# its flag, and keeps lines it doesn't manage at the end. After an edit:
#   systemctl --user restart pilot-engine
EOF
    engine_env_line ORCA_USER_DATA "$ENGINE_DATA_DIR"
    engine_env_line PILOT_SCHEDULER "$ENGINE_SCHEDULER"
    engine_env_line PILOT_AUTOMATION_DIRS "$ENGINE_AUTOMATION_DIRS"
    engine_env_line PILOT_VAULT_EXPORT "$ENGINE_VAULT_EXPORT"
    engine_env_line PILOT_VAULT_AUTOMATIONS "$ENGINE_VAULT_DIR"
    engine_env_line PILOT_USAGE_REPORT_DIR "$ENGINE_USAGE_REPORT_DIR"
    engine_env_line PILOT_USAGE_TEMPLATE "$ENGINE_SERVER_DIR/usage_report.html"
    engine_env_line PATH "$ENGINE_PATH"
    engine_env_line PILOT_ENGINE_SERVER_DIR "$ENGINE_SERVER_DIR"
    engine_env_line PILOT_ENGINE_PORT "$ENGINE_PORT"
    engine_env_line PILOT_ENGINE_BIND "$ENGINE_BIND"
    engine_env_line PILOT_ENGINE_PAIRING_ADDRESS "$ENGINE_PAIRING_ADDRESS"
    engine_env_line PILOT_ENGINE_MACHINE_NAME "$SETUP_MACHINE_NAME"
    if [ -n "$ENGINE_KEPT_LINES" ]; then
      printf '\n# Lines added by hand, kept as they are:\n%s' "$ENGINE_KEPT_LINES"
    fi
  }
}

# A here-string, not a pipe: write_file must run in this shell to report SETUP_WROTE.
engine_write_env_file() {
  write_file "$ENGINE_ENV_FILE" 600 <<<"$(engine_env_content)"
}

engine_write_launcher() {
  write_file "$ENGINE_LAUNCHER" 755 <<EOF
#!/usr/bin/env bash
# Starts Pilot's headless engine (orcad) with engine.env's settings; pilot-engine.service runs it.
# Written by src/packages/pilot/scripts/machine-setup/linux-engine.sh.
set -euo pipefail
if [ -z "\${ORCA_USER_DATA:-}" ]; then
  set -a
  # shellcheck source=/dev/null
  . "\${PILOT_ENGINE_ENV_FILE:-$ENGINE_ENV_FILE}"
  set +a
fi
server=\$PILOT_ENGINE_SERVER_DIR
# 78 (EX_CONFIG): a restart can't fix a missing install, so systemd stops retrying.
if [ ! -f "\$server/orcad/.runtime-node" ]; then
  echo "pilot-engine: no engine installed at \$server; re-run the machine setup script" >&2
  exit 78
fi
sha=\$(tr -d '[:space:]' <"\$server/orcad/.runtime-node")
node=\$server/runtimes/node-\$sha/bin/node
if [ ! -x "\$node" ]; then
  echo "pilot-engine: no Node runtime at \$node; re-run the machine setup script" >&2
  exit 78
fi
args=(--port "\${PILOT_ENGINE_PORT:-$ENGINE_DEFAULT_PORT}" --bind "\${PILOT_ENGINE_BIND:-127.0.0.1}")
if [ -n "\${PILOT_ENGINE_PAIRING_ADDRESS:-}" ]; then
  args+=(--pairing-address "\$PILOT_ENGINE_PAIRING_ADDRESS")
fi
if [ "\${PILOT_ENGINE_PAIRING:-}" = on ]; then
  # The one run that prints a pairing code never ticks.
  export PILOT_SCHEDULER=off
else
  # A service's log must never hold a pairing offer (as \`orca serve service install\`).
  args+=(--no-pairing)
fi
# At boot, Tailscale can bring its address up after this starts.
bind=\${PILOT_ENGINE_BIND:-127.0.0.1}
case \$bind in
  127.* | ::1 | 0.0.0.0 | ::) ;;
  *)
    if command -v ip >/dev/null 2>&1; then
      waited=0
      while ! ip -o addr show | grep -qF " \$bind/"; do
        if [ "\$waited" -ge 300 ]; then
          echo "pilot-engine: \$bind isn't on any interface after 300 s (is Tailscale up?)" >&2
          exit 1
        fi
        sleep 1
        waited=\$((waited + 1))
      done
    fi
    ;;
esac
exec "\$node" "\$server/orcad/orcad.js" "\${args[@]}"
EOF
}

engine_write_cli() {
  write_file "$ENGINE_CLI" 755 <<EOF
#!/usr/bin/env bash
# Pilot's CLI for this machine's engine. It runs the launcher orcad writes into its data folder at
# startup, which pins that folder (ORCA_USER_DATA_PATH). Written by machine-setup/linux-engine.sh.
set -euo pipefail
launcher="$ENGINE_DATA_DIR/cli/bin/orca"
if [ ! -x "\$launcher" ]; then
  echo "pilot: the engine hasn't started yet (\$launcher is missing). Start it: systemctl --user start pilot-engine" >&2
  exit 1
fi
exec "\$launcher" "\$@"
EOF
}

engine_write_unit() {
  write_file "$ENGINE_UNIT_FILE" 644 <<EOF
[Unit]
Description=Pilot engine (headless orcad)
Documentation=https://github.com/nsitapara/orca/blob/pilot/src/packages/pilot/docs/machine-setup.md
# orca serve service install's crash-loop brake. The launcher's wait for the bind address (up to 300 s)
# spaces restarts out, so a slow Tailscale never trips it.
StartLimitIntervalSec=900
StartLimitBurst=5

[Service]
Type=simple
EnvironmentFile=$ENGINE_ENV_FILE
ExecStart=$ENGINE_LAUNCHER
Restart=on-failure
RestartSec=10
# 78 is orcad's configuration exit: a restart can't fix it.
RestartPreventExitStatus=78
TimeoutStopSec=90
# The terminal daemon outlives the server, as under the desktop app (src/cli/runtime/serve-service-unit.ts).
KillMode=process

[Install]
WantedBy=default.target
EOF
}

engine_write_files() {
  step "Engine files"
  run mkdir -p "$ENGINE_DATA_DIR" "$ENGINE_VAULT_DIR"
  run chmod 700 "$ENGINE_DATA_DIR"
  SETUP_WROTE=0
  engine_write_env_file
  engine_write_launcher
  engine_write_cli
  if [ "$SETUP_WROTE" = 1 ]; then
    ENGINE_RESTART=1
  fi
  SETUP_WROTE=0
  engine_write_unit
  if [ "$SETUP_WROTE" = 1 ]; then
    ENGINE_RESTART=1
    run systemctl --user daemon-reload
  fi
}

# --- Service ---------------------------------------------------------------------------------------

engine_check_user_manager() {
  if [ -z "${XDG_RUNTIME_DIR:-}" ] && [ -d "/run/user/$(id -u)" ]; then
    XDG_RUNTIME_DIR=/run/user/$(id -u)
    export XDG_RUNTIME_DIR
  fi
  if [ "$SETUP_DRY_RUN" = 1 ]; then
    return 0
  fi
  if ! systemctl --user show-environment >/dev/null 2>&1; then
    die "systemctl --user can't reach your user manager. Log in as this user over SSH or a console (not su or sudo -u), then re-run."
  fi
}

# Linger keeps the user manager, and so the engine, running while nobody is logged in.
engine_enable_linger() {
  local user linger=''
  user=$(id -un)
  step "Run without a login (loginctl enable-linger)"
  if engine_has loginctl; then
    linger=$(loginctl show-user "$user" --property=Linger --value 2>/dev/null || true)
  fi
  if [ "$linger" = yes ]; then
    say "  linger is already on for $user"
    return 0
  fi
  run_sudo "Let $user's services run while $user is logged out, so the engine starts at boot" loginctl enable-linger "$user"
}

engine_should_pair() {
  case $ENGINE_PAIR in
    yes) return 0 ;;
    no) return 1 ;;
  esac
  [ "$ENGINE_HAD_ENV_FILE" = 0 ] && return 0
  [ "$ENGINE_OLD_PILOT_ENGINE_BIND" != "$ENGINE_BIND" ] && return 0
  [ "$ENGINE_OLD_PILOT_ENGINE_PORT" != "$ENGINE_PORT" ] && return 0
  [ "$ENGINE_OLD_PILOT_ENGINE_PAIRING_ADDRESS" != "$ENGINE_PAIRING_ADDRESS" ] && return 0
  return 1
}

# One run with a pairing offer, its stdout in a private file; the service never prints one. The offer's
# token stays valid after this run stops (runtime/device-registry.ts validateToken), and a re-run hands
# out the same unused token (getOrCreatePendingDevice).
engine_pair() {
  local out=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/pilot-engine-pairing.txt waited=0
  step "Pairing code (one short run with a pairing offer)"
  engine_stop_service
  run rm -f "$out"
  run systemd-run --user --unit "$ENGINE_PAIRING_UNIT" --collect --quiet \
    --property=UMask=0077 --property="StandardOutput=file:$out" --property=StandardError=journal \
    --setenv=PILOT_ENGINE_PAIRING=on --setenv="PILOT_ENGINE_ENV_FILE=$ENGINE_ENV_FILE" "$ENGINE_LAUNCHER"
  if [ "$SETUP_DRY_RUN" = 1 ]; then
    say "  (waits up to 180 s for the 'Pairing URL: orca://pair?code=...' line, then stops that run)"
    ENGINE_PAIRING_URL='orca://pair?code=<printed here>'
    return 0
  fi
  while ! grep -q '^Pairing URL: ' "$out" 2>/dev/null; do
    if ! systemctl --user is-active --quiet "$ENGINE_PAIRING_UNIT"; then
      rm -f "$out"
      die "the pairing run stopped before it printed a code; see: journalctl --user -u $ENGINE_PAIRING_UNIT"
    fi
    if [ "$waited" -ge 180 ]; then
      systemctl --user stop "$ENGINE_PAIRING_UNIT" || true
      rm -f "$out"
      die "no pairing code after 180 s; see: journalctl --user -u $ENGINE_PAIRING_UNIT"
    fi
    sleep 1
    waited=$((waited + 1))
  done
  ENGINE_PAIRING_URL=$(sed -n 's/^Pairing URL: //p' "$out" | head -n 1)
  run systemctl --user stop "$ENGINE_PAIRING_UNIT"
  rm -f "$out"
}

engine_start() {
  step "Start $ENGINE_UNIT"
  if ! engine_has systemctl || ! systemctl --user is-enabled --quiet "$ENGINE_UNIT" 2>/dev/null; then
    run systemctl --user enable "$ENGINE_UNIT"
  fi
  if engine_service_active; then
    if [ "$ENGINE_RESTART" = 1 ]; then
      run systemctl --user restart "$ENGINE_UNIT"
    else
      say "  running, and nothing it reads changed"
    fi
  else
    run systemctl --user start "$ENGINE_UNIT"
  fi
}

engine_wait_for_cli() {
  local waited=0
  if [ "$SETUP_DRY_RUN" = 1 ]; then
    say "  (waits up to 90 s for \`pilot automations status\` to answer)"
    return 0
  fi
  until "$ENGINE_CLI" automations status --json >/dev/null 2>&1; do
    if [ "$waited" -ge 90 ]; then
      die "the engine didn't answer in 90 s; see: journalctl --user -u $ENGINE_UNIT"
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

engine_add_repos() {
  local repo listed=''
  if [ "${#ENGINE_ADD_REPOS[@]}" = 0 ]; then
    return 0
  fi
  if [ "$SETUP_DRY_RUN" != 1 ]; then
    listed=$("$ENGINE_CLI" repo list --json)
  fi
  for repo in "${ENGINE_ADD_REPOS[@]}"; do
    case $listed in
      *"\"path\":\"$repo\""* | *"\"path\": \"$repo\""*) say "  already registered: $repo" ;;
      *) run "$ENGINE_CLI" repo add --path "$repo" ;;
    esac
  done
}

engine_configure() {
  step "Name the machine and register projects"
  engine_wait_for_cli
  run "$ENGINE_CLI" host name --name "$SETUP_MACHINE_NAME"
  engine_add_repos
}

engine_summary() {
  local name config=$ENGINE_CONFIG_HOME/pilotcli/config.toml
  name=$(setup_single_quote "$SETUP_MACHINE_NAME")
  step "Pair this engine from the main Mac"
  if [ -n "$ENGINE_PAIRING_URL" ]; then
    say "Run this on the main Mac. The code is a credential: paste it nowhere else."
    say ""
    say "  pilot environment add --name $name --pairing-code $(setup_single_quote "$ENGINE_PAIRING_URL")"
  else
    say "No new pairing code this run. Already paired? On the main Mac: pilot environment list."
    say "For a new code, re-run with --pair."
  fi
  say ""
  say "Then check from the main Mac:"
  say "  pilot host name --environment $name"
  say "  pilot automations status --environment $name --json   # machineName, schedulerOn"
  say ""
  say "On this machine: \`pilot automations status\`; the engine's log: \`journalctl --user -u $ENGINE_UNIT -f\`"
  if [ ! -f "$config" ] || ! grep -qF "$ENGINE_CLI" "$config"; then
    say ""
    say "pilotcli reads $config. Copy it from the main Mac and give it this machine's paths"
    say "(its defaults are macOS paths, and Pilot strips PILOT_* from pilotcli's env):"
    say "  [paths]"
    say "  pilot = \"$ENGINE_CLI\""
    say "  glab_config = \"$ENGINE_CONFIG_HOME/glab-cli/config.yml\""
    say "  cache_dir = \"$HOME/.cache/pilotcli\""
    say "  telemetry_file = \"$HOME/.local/state/pilotcli/telemetry.jsonl\""
  fi
}

# The engine steps; debian.sh and arch.sh call it after packages, Node and the checkouts.
engine_main() {
  engine_resolve_settings
  engine_check_user_manager
  setup_ensure_pnpm "$SETUP_REPO_DIR"
  if [ "$ENGINE_SKIP_BUILD" = 1 ]; then
    say "  (--skip-build: using the last build in $SETUP_REPO_DIR/out)"
  else
    engine_build
  fi
  engine_install_server
  engine_write_files
  engine_enable_linger
  if engine_should_pair; then
    engine_pair
  fi
  engine_start
  engine_configure
  engine_summary
}

engine_usage() {
  cat <<'EOF'
Usage: linux-engine.sh [--machine-name <name>] [options]

Updates Pilot's headless engine on a Linux machine that debian.sh or arch.sh already set up: updates
the checkout, rebuilds orcad, reinstalls it and restarts pilot-engine.service. It installs no
packages and no Node. --machine-name may be left out once engine.env has one.

Options:
EOF
  setup_common_help
  engine_help
}

engine_standalone_main() {
  local os
  while [ $# -gt 0 ]; do
    case $1 in
      -h | --help)
        engine_usage
        exit 0
        ;;
    esac
    setup_take_common_flag "$@"
    if [ "$SETUP_SHIFT" = 0 ]; then
      engine_take_flag "$@"
    fi
    if [ "$SETUP_SHIFT" = 0 ]; then
      die "unknown option: $1 (see --help)"
    fi
    shift "$SETUP_SHIFT"
  done
  os=$(setup_detect_os)
  case $os in
    debian | arch) setup_require_os "$os" ;;
    *) die "linux-engine.sh runs on Debian, Ubuntu or Arch; this machine is $os" ;;
  esac
  engine_default_machine_name
  setup_check_common
  setup_banner
  linux_prefer_fnm_node
  if [ "$(setup_node_major)" != 24 ] && [ "$SETUP_DRY_RUN" != 1 ]; then
    die "Node 24 isn't on PATH. Run debian.sh or arch.sh first."
  fi
  setup_ensure_pilot_repo
  if [ -n "$SETUP_PILOTCLI_REPO$SETUP_PILOTCLI_BINARY" ]; then
    setup_install_pilotcli
  fi
  engine_main
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  engine_standalone_main "$@"
fi
