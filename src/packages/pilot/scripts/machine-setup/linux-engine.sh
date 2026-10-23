#!/usr/bin/env bash
# Pilot's headless engine (orcad) on Linux, shared by debian.sh and arch.sh: Node 24 for the build,
# then build orcad, install it under ~/.local/share/pilot, write ~/.config/pilot/engine.env, run it as
# the systemd user service pilot-engine.service, name the machine, and print the pairing command for
# the main Mac. Run it alone to update an engine whose packages and Node are already in place.
# Guide: src/packages/pilot/docs/machine-setup.md.
# shellcheck disable=SC2034 # SETUP_* globals belong to step-runner.sh and checkouts-and-toolchain.sh.
set -euo pipefail

ENGINE_SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=step-runner.sh
. "$ENGINE_SCRIPT_DIR/step-runner.sh"
# shellcheck source=checkouts-and-toolchain.sh
. "$ENGINE_SCRIPT_DIR/checkouts-and-toolchain.sh"

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
# fnm publishes no checksum file. These are GitHub's sha256 digests of the release's assets
# (gh api repos/Schniz/fnm/releases/tags/v1.39.0); bump the version and both digests together.
LINUX_FNM_VERSION=v1.39.0
LINUX_FNM_SHA256_X64=7807664f39d39fc518da1c35ba0181e4b3267603c4b1dedeb4b5fc6ae440a224
LINUX_FNM_SHA256_ARM64=4eaff58b2c5bf30d0934027572dd0b5bbb60d2a1af309230b53662d4b1d45599

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
  --pairing-address <addr>  Address the pairing code advertises. Default: the bind address when it is
                            a specific IP (orcad alone would advertise 127.0.0.1). Required with
                            --bind 0.0.0.0 or ::. "none" goes back to the default.
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

# The major version pacman's repos have for <package>, or nothing.
linux_pacman_major() {
  pacman -Si "$1" 2>/dev/null | sed -n 's/^Version *: *\([0-9][0-9]*\)\..*/\1/p' | head -n 1
}

linux_download_fnm() {
  local asset sum
  case $(uname -m) in
    x86_64 | amd64)
      asset='fnm-linux.zip'
      sum=$LINUX_FNM_SHA256_X64
      ;;
    aarch64 | arm64)
      asset='fnm-arm64.zip'
      sum=$LINUX_FNM_SHA256_ARM64
      ;;
    *) die "fnm has no build for $(uname -m); install Node 24 yourself, then re-run" ;;
  esac
  run mkdir -p "$SETUP_BIN_DIR" "$LINUX_FNM_DIR"
  run curl -fsSL -o "$LINUX_FNM_DIR/$asset" "https://github.com/Schniz/fnm/releases/download/$LINUX_FNM_VERSION/$asset"
  if [ "$SETUP_DRY_RUN" != 1 ] && [ "$(setup_sha256 "$LINUX_FNM_DIR/$asset")" != "$sum" ]; then
    rm -f "$LINUX_FNM_DIR/$asset"
    die "the fnm $LINUX_FNM_VERSION download's checksum doesn't match; nothing was installed"
  fi
  run unzip -o "$LINUX_FNM_DIR/$asset" fnm -d "$SETUP_BIN_DIR"
  run chmod 755 "$SETUP_BIN_DIR/fnm"
  run rm -f "$LINUX_FNM_DIR/$asset"
}

# Any Node 24 already on PATH wins. On Arch, next comes pacman's Node 24 LTS (nodejs-lts-krypton), unless
# another nodejs is installed, which it would have to replace; then nodejs itself if it is 24. Last, fnm,
# under an alias of its own ("pilot"), so your fnm default is left alone.
linux_ensure_node24() {
  local distro=$1 fnm=''
  step "Node 24 (package.json engines) and pnpm"
  linux_prefer_fnm_node
  if [ "$(setup_node_major)" = 24 ]; then
    say "  Node $(node --version) at $(command -v node)"
    return 0
  fi
  if [ "$distro" = arch ] && engine_has pacman; then
    if [ "$(linux_pacman_major nodejs-lts-krypton)" = 24 ]; then
      if pacman -Q nodejs >/dev/null 2>&1; then
        say "  nodejs $(pacman -Q nodejs | cut -d' ' -f2) is installed, and nodejs-lts-krypton would replace it: using fnm"
      else
        run_sudo "Install Node 24 LTS from pacman (nodejs-lts-krypton, npm)" pacman -S --needed --noconfirm nodejs-lts-krypton npm
        return 0
      fi
    elif [ "$(linux_pacman_major nodejs)" = 24 ]; then
      run_sudo "Install Node 24 from pacman (nodejs, npm)" pacman -S --needed --noconfirm nodejs npm
      return 0
    fi
  fi
  if engine_has fnm; then
    fnm=$(command -v fnm)
  elif [ -x "$SETUP_BIN_DIR/fnm" ]; then
    fnm=$SETUP_BIN_DIR/fnm
  elif [ "$distro" = arch ]; then
    run_sudo "Install fnm, which installs Node 24 for your user (pacman has no Node 24 to use here)" pacman -S --needed --noconfirm fnm
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

ENGINE_KEPT_MARKER='# Lines added by hand (comments too), kept as they are:'

engine_env_header() {
  cat <<'EOF'
# Pilot engine settings, read by pilot-engine.service and ~/.local/bin/pilot-engine. Written by
# src/packages/pilot/scripts/machine-setup/linux-engine.sh: a re-run keeps each value unless you pass
# its flag. Lines it doesn't manage, comments included, move to the end and are kept. After an edit:
#   systemctl --user restart pilot-engine
EOF
}

# Reads engine.env without running it: managed keys into ENGINE_OLD_<KEY>; every other line, comments
# included, kept verbatim. Only this script's own header and marker lines are dropped.
engine_read_env_file() {
  local line key value own
  [ -f "$ENGINE_ENV_FILE" ] || return 0
  ENGINE_HAD_ENV_FILE=1
  own=$'\n'$(engine_env_header)$'\n'$ENGINE_KEPT_MARKER$'\n'
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in '') continue ;; esac
    case $own in *$'\n'"$line"$'\n'*) continue ;; esac
    case $line in
      '#'*)
        ENGINE_KEPT_LINES="$ENGINE_KEPT_LINES$line"$'\n'
        continue
        ;;
    esac
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

# The address the pairing code advertises. Without --pairing-address orcad advertises 127.0.0.1 whatever
# it binds (resolveAdvertisedPairingEndpoint, src/main/runtime/pairing-endpoint.ts), which would pair
# the main Mac to itself, so a specific bind IP stands in for it. The launcher applies the same rule.
engine_advertised_address() {
  if [ -n "$ENGINE_PAIRING_ADDRESS" ]; then
    printf '%s' "$ENGINE_PAIRING_ADDRESS"
    return 0
  fi
  case $ENGINE_BIND in
    0.0.0.0 | ::) return 1 ;;
    *) printf '%s' "$ENGINE_BIND" ;;
  esac
}

# Where orcad listens and what its pairing code advertises. Called before anything is installed, so a
# setting that can't pair stops the setup first.
engine_resolve_network() {
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
  engine_check_value --pairing-address "$ENGINE_PAIRING_ADDRESS"
  if ! ENGINE_ADVERTISED=$(engine_advertised_address); then
    die "--bind $ENGINE_BIND listens on every interface, and without --pairing-address the pairing code would advertise 127.0.0.1 (the main Mac itself). Pass --pairing-address <IP the main Mac reaches>, or --bind tailscale."
  fi
}

# orcad writes an `orca` launcher pinned to its data folder into <data>/cli/bin at startup
# (orcad-cli-launcher.ts). Under orcad Pilot's shell steps get no launcher folder (engine-env.ts), so
# that folder goes first; it stays out of your shell's PATH.
engine_path_with_orca_first() {
  local cli=$ENGINE_DATA_DIR/cli/bin old_cli='' entry out='' parts=()
  if [ -n "$ENGINE_OLD_ORCA_USER_DATA" ]; then
    old_cli=$ENGINE_OLD_ORCA_USER_DATA/cli/bin
  fi
  IFS=: read -r -a parts <<<"$1"
  for entry in ${parts[@]+"${parts[@]}"}; do
    if [ -n "$entry" ] && [ "$entry" != "$cli" ] && [ "$entry" != "$old_cli" ]; then
      out=$out:$entry
    fi
  done
  printf '%s' "$cli$out"
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
  # A systemd user service gets a bare PATH, and orcad on plain Linux doesn't read the login shell's,
  # so shell steps and field scripts find tools only through this one.
  if [ -x "$LINUX_FNM_NODE_BIN/node" ]; then
    node_dir=$LINUX_FNM_NODE_BIN:
  elif engine_has node; then
    node_dir=$(dirname "$(command -v node)"):
  fi
  default_path=$SETUP_BIN_DIR:$node_dir/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  ENGINE_PATH=$(engine_path_with_orca_first "$(engine_pick '' PATH "$default_path")")

  engine_check_value --machine-name "$SETUP_MACHINE_NAME"
  engine_check_value --data-dir "$ENGINE_DATA_DIR"
  engine_check_value --automation-dirs "$ENGINE_AUTOMATION_DIRS"
  engine_check_value --vault-dir "$ENGINE_VAULT_DIR"
  engine_check_value --usage-report-dir "$ENGINE_USAGE_REPORT_DIR"
  engine_check_value PATH "$ENGINE_PATH"
  case "$ENGINE_ENV_FILE$ENGINE_LAUNCHER$ENGINE_SERVER_ROOT" in
    *[[:space:]%]*) die "these paths can't hold spaces or % (systemd reads them): $ENGINE_ENV_FILE, $ENGINE_LAUNCHER, $ENGINE_SERVER_ROOT" ;;
  esac

  say "  machine name      $SETUP_MACHINE_NAME"
  say "  scheduler         PILOT_SCHEDULER=$ENGINE_SCHEDULER"
  say "  listens on        $ENGINE_BIND:$ENGINE_PORT; the pairing code advertises $ENGINE_ADVERTISED:$ENGINE_PORT"
  say "  data folder       $ENGINE_DATA_DIR"
  say "  automations       $ENGINE_AUTOMATION_DIRS"
  say "  vault             export $ENGINE_VAULT_EXPORT; Details bundles in $ENGINE_VAULT_DIR"
  say "  token report      $ENGINE_USAGE_REPORT_DIR"
  say "  server            $ENGINE_SERVER_ROOT (current: the build the service runs)"
  say "  PATH              $ENGINE_PATH"
  case $ENGINE_BIND in
    127.* | ::1)
      warn "the engine listens on $ENGINE_BIND only, so the main Mac can't reach it. Re-run with --bind tailscale (or a LAN IP) to pair it."
      ;;
  esac
}

# --- Build and install -----------------------------------------------------------------------------

# CI's glibc 2.28 builders (.github/workflows/node-server-tests.yml), pinned by digest.
ENGINE_SLOT_IMAGE_X64=quay.io/pypa/manylinux_2_28_x86_64@sha256:407f771c51a2c3e83ebe5a7970b4289ead3a6db21d9b9c089168775cad11d328
ENGINE_SLOT_IMAGE_ARM64=quay.io/pypa/manylinux_2_28_aarch64@sha256:c22ffd129ac99a8a42d1f2c2f4e88a9089288dd9ee987a7092da1c7dc48f27a9

# build:orcad compiles node-pty on this host when out/orcad-prebuilds has no verified slot, and refuses a
# pty.node that won't load on glibc 2.28. A rolling distro's compiler (Arch's) links newer symbols, so build the
# slot as CI does: in a manylinux_2_28 container, with gcc-toolset, under the pinned Node the build downloads
# anyway (it runs on glibc 2.28). Without Docker, build:orcad tries the host, which works on Debian or Ubuntu.
engine_build_pty_slot() {
  local repo=$SETUP_REPO_DIR slot node image store
  if [ "$SETUP_DRY_RUN" = 1 ]; then
    say "  (builds node-pty's slot in a manylinux_2_28 container when out/orcad-prebuilds has none and Docker answers)"
    return 0
  fi
  slot=$(cd "$repo" && node config/scripts/build-orcad-prebuilds.mjs --print-slot) || die "couldn't read this machine's orcad prebuild slot"
  if (cd "$repo" && node config/scripts/build-orcad-prebuilds.mjs --require-slots "$slot" >/dev/null 2>&1); then
    say "  node-pty's $slot slot is already built and verified"
    return 0
  fi
  case "$slot" in
    linux-x64-glibc) image=$ENGINE_SLOT_IMAGE_X64 ;;
    linux-arm64-glibc) image=$ENGINE_SLOT_IMAGE_ARM64 ;;
    *)
      say "  no container builds the $slot slot; build:orcad builds it on this host"
      return 0
      ;;
  esac
  if ! engine_has docker || ! docker info >/dev/null 2>&1; then
    warn "Docker isn't reachable, so build:orcad builds node-pty on this host. If its glibc 2.28 check fails (likely on Arch), start Docker and join its group (sudo systemctl enable --now docker; sudo usermod -aG docker \$USER), log in again, and re-run."
    return 0
  fi
  node=$(cd "$repo" && node config/scripts/build-orcad-prebuilds.mjs --print-runtime | tail -n 1) || die "couldn't fetch the pinned Node"
  # pnpm's global virtual store holds node-pty's sources outside the checkout; mount it at the same path.
  store=$(cd "$repo" && pnpm store path) || die "couldn't find pnpm's store"
  store=${store%/*}
  run docker run --rm --user "$(id -u):$(id -g "$(id -un)")" \
    -v "$repo:$repo" -v "$store:$store:ro" -v "$(dirname "$(dirname "$node")"):/opt/pinned-node:ro" \
    -e HOME=/tmp -e CC=gcc -e CXX=g++ -e PYTHON=/opt/python/cp312-cp312/bin/python3 \
    -e PATH=/opt/pinned-node/bin:/opt/rh/gcc-toolset-14/root/usr/bin:/usr/local/bin:/usr/bin:/bin \
    -w "$repo" "$image" \
    bash -c "node config/scripts/build-orcad-prebuilds.mjs --slot=$slot && node config/scripts/build-orcad-prebuilds.mjs --require-slots $slot && node config/scripts/build-orcad-prebuilds.mjs --slot=$slot --smoke"
}

engine_build() {
  step "Build orcad (pnpm install, pnpm run build:orcad)"
  # build:orcad also bundles the CLI (out/orcad/out/cli/index.js), so build:cli isn't needed here.
  run_in "$SETUP_REPO_DIR" pnpm install --frozen-lockfile
  # build:orcad ships out/mobile-web and refuses to build without it. mobile/ is its own pnpm project, so the
  # root install leaves its node_modules empty (CI: .github/actions/build-mobile-web-bundle).
  run_in "$SETUP_REPO_DIR/mobile" pnpm install --frozen-lockfile
  run_in "$SETUP_REPO_DIR" pnpm run build:mobile-web
  engine_build_pty_slot
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
  # Both name folders that get deleted below.
  [ -n "$version" ] || die "$out/orcad/.version is empty; rebuild with pnpm run build:orcad"
  [ -n "$sha" ] || die "$out/orcad/.runtime-node is empty; rebuild with pnpm run build:orcad"
  case $root in
    /?*/pilot/engine-server) ;;
    *) die "unexpected engine folder: $root" ;;
  esac
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
    case $name in '' | . | .. | */*) continue ;; esac
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
    engine_env_header
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
      printf '\n%s\n%s' "$ENGINE_KEPT_MARKER" "$ENGINE_KEPT_LINES"
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
bind=\${PILOT_ENGINE_BIND:-127.0.0.1}
# Without --pairing-address orcad advertises 127.0.0.1 whatever it binds (pairing-endpoint.ts).
pairing=\${PILOT_ENGINE_PAIRING_ADDRESS:-}
if [ -z "\$pairing" ]; then
  case \$bind in
    0.0.0.0 | ::)
      echo "pilot-engine: PILOT_ENGINE_BIND=\$bind needs PILOT_ENGINE_PAIRING_ADDRESS in engine.env" >&2
      exit 78
      ;;
    *) pairing=\$bind ;;
  esac
fi
args=(--port "\${PILOT_ENGINE_PORT:-$ENGINE_DEFAULT_PORT}" --bind "\$bind" --pairing-address "\$pairing")
if [ "\${PILOT_ENGINE_PAIRING:-}" = on ]; then
  # The one run that prints a pairing code never ticks.
  export PILOT_SCHEDULER=off
else
  # A service's log must never hold a pairing offer (as \`orca serve service install\`).
  args+=(--no-pairing)
fi
# At boot, Tailscale can bring its address up after this starts.
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

# Before anything is installed: the engine is a systemd user service, so it needs a user manager and a
# user that isn't root.
engine_check_user_manager() {
  if [ "$(id -u)" = 0 ]; then
    die "run this as the user who will own the engine, not root: pilot-engine is a systemd user service. Each sudo step asks for itself."
  fi
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
ENGINE_PAIRING_OUT=

# Stops the pairing run and deletes its code file, however the setup ends.
engine_pairing_cleanup() {
  systemctl --user stop "$ENGINE_PAIRING_UNIT" >/dev/null 2>&1 || true
  if [ -n "$ENGINE_PAIRING_OUT" ]; then
    rm -f "$ENGINE_PAIRING_OUT"
  fi
}

engine_pair() {
  local out=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/pilot-engine-pairing.txt waited=0 reason guidance
  step "Pairing code (one short run with a pairing offer)"
  engine_stop_service
  # A run an interrupted setup left behind would hold the unit name.
  run systemctl --user stop "$ENGINE_PAIRING_UNIT" || true
  run rm -f "$out"
  if [ "$SETUP_DRY_RUN" != 1 ]; then
    ENGINE_PAIRING_OUT=$out
    trap engine_pairing_cleanup EXIT
    trap 'engine_pairing_cleanup; exit 129' HUP
    trap 'engine_pairing_cleanup; exit 130' INT
    trap 'engine_pairing_cleanup; exit 143' TERM
  fi
  run systemd-run --user --unit "$ENGINE_PAIRING_UNIT" --collect --quiet \
    --property=UMask=0077 --property="StandardOutput=file:$out" --property=StandardError=journal \
    --setenv=PILOT_ENGINE_PAIRING=on --setenv="PILOT_ENGINE_ENV_FILE=$ENGINE_ENV_FILE" "$ENGINE_LAUNCHER"
  if [ "$SETUP_DRY_RUN" = 1 ]; then
    say "  (waits up to 180 s for the 'Pairing URL: orca://pair?code=...' line, then stops that run)"
    ENGINE_PAIRING_URL='orca://pair?code=<printed here>'
    return 0
  fi
  # The EXIT trap stops the run and deletes the file on every way out below.
  while ! grep -q '^Pairing URL: ' "$out" 2>/dev/null; do
    if grep -q '^Pairing unavailable: ' "$out" 2>/dev/null; then
      reason=$(sed -n 's/^Pairing unavailable: //p' "$out" | head -n 1)
      guidance=$(sed -n 's/^Pairing guidance: //p' "$out" | head -n 1)
      die "orcad made no pairing code ($reason). $guidance"
    fi
    if ! systemctl --user is-active --quiet "$ENGINE_PAIRING_UNIT"; then
      die "the pairing run stopped before it printed a code; see: journalctl --user -u $ENGINE_PAIRING_UNIT"
    fi
    if [ "$waited" -ge 180 ]; then
      die "no pairing code after 180 s; see: journalctl --user -u $ENGINE_PAIRING_UNIT"
    fi
    sleep 1
    waited=$((waited + 1))
  done
  ENGINE_PAIRING_URL=$(sed -n 's/^Pairing URL: //p' "$out" | head -n 1)
  engine_pairing_cleanup
  trap - EXIT HUP INT TERM
  ENGINE_PAIRING_OUT=
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
  # pilotcli reads $HOME/.config/pilotcli/config.toml, not XDG_CONFIG_HOME (pilotCLI internal/config/config.go).
  local name config=$HOME/.config/pilotcli/config.toml
  name=$(setup_single_quote "$SETUP_MACHINE_NAME")
  step "Pair this engine from the main Mac"
  if [ -n "$ENGINE_PAIRING_URL" ]; then
    say "Run this on the main Mac. The code is a credential: paste it nowhere else."
    say "It advertises $ENGINE_ADVERTISED:$ENGINE_PORT, which the main Mac must reach."
    say ""
    if [ "$ENGINE_HAD_ENV_FILE" = 1 ]; then
      say "  pilot environment rm --environment $name   # if the main Mac already has this machine"
    fi
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
    say "Leave paths.orca as it is: it names real Orca, which isn't on this machine, so pilotcli's"
    say "real-Orca checks (is a worktree busy there) don't work here."
  fi
}

# The engine steps; debian.sh and arch.sh call it after packages, Node and the checkouts.
engine_main() {
  engine_resolve_settings
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
  engine_check_user_manager
  engine_resolve_network
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
