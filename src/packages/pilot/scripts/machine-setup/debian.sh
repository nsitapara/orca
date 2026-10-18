#!/usr/bin/env bash
# Sets up a Debian or Ubuntu machine (most likely a headless server) to run Pilot's engine, orcad, as
# the systemd user service pilot-engine.service: apt packages, Node 24 (fnm), Pilot's checkout,
# ~/.agents and pilotcli, then linux-engine.sh's engine steps. Safe to re-run; it is also how the
# machine is updated. Guide: src/packages/pilot/docs/machine-setup.md.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=step-runner.sh
. "$SCRIPT_DIR/step-runner.sh"
# shellcheck source=checkouts-and-toolchain.sh
. "$SCRIPT_DIR/checkouts-and-toolchain.sh"
# shellcheck source=linux-engine.sh
. "$SCRIPT_DIR/linux-engine.sh"

DEBIAN_SKIP_PACKAGES=0
# node-gyp compiles node-pty (python3, make, g++); the build gate reads it with objdump (binutils, in
# build-essential); fnm's download is a zip; ps and ip serve Pilot and the engine launcher.
DEBIAN_PACKAGES=(git curl ca-certificates build-essential python3 unzip procps iproute2)

usage() {
  cat <<'EOF'
Usage: debian.sh --machine-name <name> [options]

Sets up this Debian or Ubuntu machine to run Pilot's headless engine (orcad) as the systemd user
service pilot-engine.service, then prints the command that pairs it from the main Mac. Re-run it to
update the machine. Example:

  debian.sh --machine-name "Debian box" --bind tailscale --pilotcli-repo https://github.com/nsitapara/pilotCLI.git

Options:
EOF
  setup_common_help
  cat <<'EOF'
  --skip-packages           Don't check or install apt packages.
EOF
  engine_help
}

debian_install_packages() {
  local missing=() package
  step "System packages (apt)"
  for package in "${DEBIAN_PACKAGES[@]}"; do
    if ! dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
      missing+=("$package")
    fi
  done
  if [ "${#missing[@]}" = 0 ]; then
    say "  installed: ${DEBIAN_PACKAGES[*]}"
    return 0
  fi
  run_sudo "Refresh apt's package lists" apt-get update
  run_sudo "Install what building Pilot's engine needs: ${missing[*]}" apt-get install -y --no-install-recommends "${missing[@]}"
}

main() {
  while [ $# -gt 0 ]; do
    case $1 in
      -h | --help)
        usage
        exit 0
        ;;
      --skip-packages)
        DEBIAN_SKIP_PACKAGES=1
        shift
        continue
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
  setup_require_os debian
  engine_default_machine_name
  setup_check_common
  setup_banner
  # Before any package, Node or clone: refuse what can't end in a working, pairable engine.
  engine_check_user_manager
  engine_resolve_network
  if [ "$DEBIAN_SKIP_PACKAGES" = 0 ]; then
    debian_install_packages
  fi
  linux_ensure_node24 debian
  setup_ensure_pilot_repo
  setup_ensure_agents
  setup_install_pilotcli
  setup_link_skills
  engine_main
}

main "$@"
